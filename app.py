"""Padeel Studio v2 — FastAPI/FFmpeg service, Roblox Open Cloud Assets API."""
import asyncio
import json
import os
import re
import subprocess
import tempfile
import time
from collections import defaultdict, deque
from pathlib import Path

import httpx
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

BASE = Path(__file__).resolve().parent
MAX_SOURCE_BYTES = 50 * 1024 * 1024
MAX_OUTPUT_BYTES = 20 * 1024 * 1024
ROBLOX_ASSETS = 'https://apis.roblox.com/assets/v1'
CONVERT_SEM = asyncio.Semaphore(2)
LIMITS = defaultdict(deque)
ALLOWED_EXT = {'.mp3', '.ogg', '.wav', '.flac'}

app = FastAPI(title='Padeel Studio v2', docs_url=None, redoc_url=None)
app.mount('/static', StaticFiles(directory=str(BASE / 'static')), name='static')

class Settings(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    trim_start: float = Field(default=0, ge=0, le=86400)
    trim_end: float = Field(default=0, ge=0, le=86400)  # 0 means end of file
    volume: int = Field(default=100, ge=0, le=200)
    pitch: int = Field(default=0, ge=-12, le=12)
    speed: float = Field(default=1, ge=.5, le=2)
    normalize: bool = False
    fade: bool = True


def safe_name(s):
    s = re.sub(r'[\x00-\x1f\x7f]', '', s).strip()
    return s[:120] or 'Untitled Audio'


def parse_settings(text):
    try:
        p = Settings.model_validate_json(text)
        p.name = safe_name(p.name)
        return p
    except (ValidationError, ValueError) as e:
        raise HTTPException(422, 'Pengaturan audio tidak valid') from e


def inspect_audio(path):
    try:
        r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', str(path)],
            capture_output=True, text=True, timeout=20, check=True)
        data = json.loads(r.stdout)
        if not data.get('streams'):
            raise ValueError('Tidak ditemukan stream audio')
        duration = float(data['format']['duration'])
        if not 0 < duration < 86400:
            raise ValueError('Durasi audio tidak valid')
        return duration
    except (subprocess.SubprocessError, ValueError, KeyError, json.JSONDecodeError) as e:
        raise HTTPException(422, 'File tidak valid atau bukan audio yang didukung') from e


def build_filters(p, duration):
    end = min(duration, p.trim_end) if p.trim_end else duration
    start = min(duration, p.trim_start)
    if end <= start:
        raise HTTPException(422, 'Waktu akhir harus lebih besar dari waktu mulai')
    ratio = (2 ** (p.pitch / 12)) * p.speed
    output_duration = (end - start) / ratio
    if output_duration > 420.01:
        raise HTTPException(422, 'Hasil audio melebihi 7 menit. Potong atau percepat audio.')
    # Changing sample rate changes pitch and tempo together, matching v1's editor behavior.
    filters = [f'atrim=start={start:.4f}:end={end:.4f}', 'asetpts=PTS-STARTPTS',
               'aresample=44100', f'asetrate={44100 * ratio:.4f}', 'aresample=44100',
               f'volume={p.volume / 100:.4f}']
    if p.fade:
        fade = min(.12, output_duration / 4)
        filters.extend([f'afade=t=in:st=0:d={fade:.4f}',
                        f'afade=t=out:st={max(0, output_duration - fade):.4f}:d={fade:.4f}'])
    if p.normalize:
        filters.append('loudnorm=I=-16:TP=-1.5:LRA=11')
    return ','.join(filters), output_duration


def convert_audio(input_path, output_path, p):
    duration = inspect_audio(input_path)
    filters, expected = build_filters(p, duration)
    cmd = ['ffmpeg', '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
           '-i', str(input_path), '-vn', '-map_metadata', '-1', '-af', filters,
           '-ac', '2', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '192k', str(output_path)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=140)
    except subprocess.TimeoutExpired as e:
        raise HTTPException(422, 'Konversi audio melebihi batas waktu') from e
    if r.returncode != 0 or not output_path.exists():
        raise HTTPException(422, 'Gagal mengonversi audio. Cek file input dan pengaturannya.')
    size = output_path.stat().st_size
    if size == 0 or size > MAX_OUTPUT_BYTES:
        raise HTTPException(422, 'Hasil konversi melebihi batas Roblox 20 MB')
    return {'duration': round(inspect_audio(output_path), 2), 'size': size}


async def prepare_file(upload, dest):
    ext = Path(upload.filename or '').suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, 'Hanya MP3, WAV, OGG, atau FLAC')
    total = 0
    with open(dest, 'wb') as out:
        while data := await upload.read(1024 * 1024):
            total += len(data)
            if total > MAX_SOURCE_BYTES:
                raise HTTPException(413, 'File sumber maksimal 50 MB')
            out.write(data)
    if total == 0:
        raise HTTPException(422, 'File audio kosong')


@app.middleware('http')
async def protections(request: Request, call_next):
    # Do not rely on untrusted X-Forwarded-For.
    ip = request.client.host if request.client else 'unknown'
    if request.url.path.startswith('/api/'):
        now = time.monotonic()
        bucket = LIMITS[ip]
        while bucket and now - bucket[0] > 3600:
            bucket.popleft()
        if len(bucket) >= 500:
            return JSONResponse({'detail': 'Terlalu banyak permintaan dari alamat ini'}, status_code=429)
        bucket.append(now)
        # CSRF control, browser can't read response on other origin, but uploads must also reject it.
        origin = request.headers.get('origin')
        if origin:
            expected = str(request.base_url).rstrip('/')
            # Behind trusted HTTPS proxies, configure PADEEL_PUBLIC_ORIGIN (https://your-domain).
            expected = os.environ.get('PADEEL_PUBLIC_ORIGIN', expected).rstrip('/')
            if origin.rstrip('/') != expected:
                return JSONResponse({'detail': 'Origin tidak diizinkan'}, status_code=403)
    return await call_next(request)


@app.get('/')
async def home():
    return FileResponse(BASE / 'static' / 'index.html')


@app.get('/api/health')
async def health():
    return {'ok': True, 'service': 'Padeel Studio v2'}


@app.post('/api/convert')
async def convert(file: UploadFile = File(...), settings: str = Form(...)):
    p = parse_settings(settings)
    async with CONVERT_SEM:
        with tempfile.TemporaryDirectory(prefix='padeel_') as t:
            folder = Path(t)
            source = folder / ('input' + Path(file.filename or '').suffix.lower())
            output = folder / 'edited.mp3'
            await prepare_file(file, source)
            await asyncio.to_thread(convert_audio, source, output, p)
            content = output.read_bytes()
        return Response(content, media_type='audio/mpeg', headers={
            'Content-Disposition': 'attachment; filename="padeel-edited.mp3"',
            'Cache-Control': 'no-store'})


def api_headers(key):
    return {'x-api-key': key}


async def get_operation(client, key, path):
    if not re.fullmatch(r'operations/[A-Za-z0-9_-]+', path):
        raise HTTPException(502, 'Roblox memberikan operation ID tidak valid')
    try:
        r = await client.get(f'{ROBLOX_ASSETS}/{path}', headers=api_headers(key))
    except httpx.RequestError as e:
        raise HTTPException(502, 'Koneksi ke Roblox terputus saat memeriksa status') from e
    try:
        j = r.json()
    except ValueError:
        j = {}
    if r.status_code >= 400:
        raise HTTPException(r.status_code, roblox_error(j, r.status_code))
    return operation_result(j)


def roblox_error(data, status):
    error = data.get('error')
    msg = data.get('message') or (error.get('message') if isinstance(error, dict) else None)
    if status == 429:
        return 'Dibatasi oleh Roblox: rate limit atau kuota upload. Coba lain waktu.'
    if status == 401:
        return 'API key Roblox ditolak (401). Periksa key dan izin.'
    if status == 403:
        return 'Akses Roblox ditolak (403). Cek izin Assets, kuota, dan kepemilikan.'
    return (str(msg)[:220] if msg else f'Roblox menolak request (HTTP {status})')


def operation_result(j):
    if j.get('done'):
        if j.get('error'):
            err = j['error']
            return {'status': 'failed', 'message': str(err.get('message', err))[:240]}
        a = j.get('response') or {}
        asset_id = a.get('assetId') or str(a.get('path', '')).removeprefix('assets/')
        if asset_id and str(asset_id).isdigit():
            return {'status': 'uploaded', 'assetId': str(asset_id),
                    'moderation': (a.get('moderationResult') or {}).get('moderationState', 'PENDING')}
        return {'status': 'failed', 'message': 'Operasi selesai tetapi Asset ID tidak tersedia'}
    return {'status': 'processing', 'operation': j.get('path', '')}


@app.get('/api/operations/{operation_id}')
async def operation(operation_id: str, x_roblox_api_key: str = Header(...)):
    if len(x_roblox_api_key) < 12 or len(x_roblox_api_key) > 512:
        raise HTTPException(422, 'API key tidak valid')
    async with httpx.AsyncClient(timeout=30) as client:
        return await get_operation(client, x_roblox_api_key, f'operations/{operation_id}')


@app.post('/api/upload')
async def upload_to_roblox(
    file: UploadFile = File(...), settings: str = Form(...), creator_type: str = Form(...),
    creator_id: str = Form(...), x_roblox_api_key: str = Header(...)
):
    p = parse_settings(settings)
    if creator_type not in ('user', 'group') or not re.fullmatch(r'[1-9]\d{0,19}', creator_id):
        raise HTTPException(422, 'User ID / Group ID harus numerik')
    if len(x_roblox_api_key) < 12 or len(x_roblox_api_key) > 512:
        raise HTTPException(422, 'API key tidak valid')
    async with CONVERT_SEM:
        with tempfile.TemporaryDirectory(prefix='padeel_') as t:
            folder = Path(t)
            source = folder / ('input' + Path(file.filename or '').suffix.lower())
            output = folder / 'upload.mp3'
            await prepare_file(file, source)
            metadata = await asyncio.to_thread(convert_audio, source, output, p)
            body = {'assetType': 'Audio', 'displayName': p.name,
                    'description': 'Uploaded with Padeel Studio',
                    'creationContext': {'creator': {('userId' if creator_type == 'user' else 'groupId'): creator_id}}}
            try:
                async with httpx.AsyncClient(timeout=90) as client:
                    with open(output, 'rb') as f:
                        r = await client.post(f'{ROBLOX_ASSETS}/assets', headers=api_headers(x_roblox_api_key),
                            data={'request': json.dumps(body)},
                            files={'fileContent': ('padeel.mp3', f, 'audio/mpeg')})
                    try:
                        j = r.json()
                    except ValueError:
                        j = {}
                    if r.status_code >= 400:
                        raise HTTPException(r.status_code, roblox_error(j, r.status_code))
                    current = operation_result(j)
                    path = j.get('path', '')
                    if current['status'] == 'processing' and not path:
                        raise HTTPException(502, 'Respons operasi Roblox tidak menyertakan ID')
                    # Don't retry unknown outcomes; return pending operation for manual poll.
                    for _ in range(16):
                        if current['status'] != 'processing':
                            break
                        await asyncio.sleep(2)
                        current = await get_operation(client, x_roblox_api_key, path)
                    current['duration'] = metadata['duration']
                    current['size'] = metadata['size']
                    return current
            except httpx.RequestError as e:
                raise HTTPException(502, 'Koneksi Roblox terputus. Cek Creator Dashboard sebelum mencoba ulang agar tidak duplikat.') from e
