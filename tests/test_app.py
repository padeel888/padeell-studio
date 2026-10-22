import json
import shutil
import subprocess
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
import httpx
import app

client = TestClient(app.app)

@pytest.fixture(scope='session')
def audio_sample(tmp_path_factory):
    if not shutil.which('ffmpeg'):
        pytest.skip('ffmpeg missing')
    path = tmp_path_factory.mktemp('audio') / 'test.wav'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=400:duration=3','-y',str(path)],check=True)
    return path.read_bytes()


def req(sample, settings=None, extra=None, key=None):
    s = settings if settings is not None else {'name':'Test', 'trim_end':2, 'normalize':True}
    return client.post('/api/upload',files={'file':('test.wav',BytesIO(sample),'audio/wav')},
        data={'settings':json.dumps(s),'creator_type':'user','creator_id':'1234',**(extra or {})},
        headers={'X-Roblox-API-Key':key or 'testing_key_123456789'})


def test_home():
    r=client.get('/')
    assert r.status_code==200 and 'Padeel Studio' in r.text
    assert client.get('/api/health').json()['ok']


def test_filters():
    p=app.Settings(name='Good',trim_end=1,volume=110,pitch=5,speed=1.2)
    f,d=app.build_filters(p,3)
    assert 'asetrate' in f and 0<d<1
    with pytest.raises(Exception):
        app.build_filters(app.Settings(name='too long'),500)
    with pytest.raises(Exception):
        app.build_filters(app.Settings(name='broken',trim_start=2,trim_end=1),3)


def test_preview_convert(audio_sample):
    r=client.post('/api/convert',files={'file':('test.wav',BytesIO(audio_sample),'audio/wav')},
        data={'settings':json.dumps({'name':'Test','trim_start':1,'trim_end':2,'volume':90})})
    assert r.status_code==200, r.text
    assert r.content[:3]==b'ID3' or r.content[:2]==b'\xff\xfb'
    assert len(r.content)<2*1024*1024


def test_reject_bad_file(audio_sample):
    r=client.post('/api/convert',files={'file':('test.txt',BytesIO(audio_sample),'text/plain')},data={'settings':'{"name":"Test"}'})
    assert r.status_code==415
    r=client.post('/api/convert',files={'file':('test.wav',BytesIO(b'garbage'),'audio/wav')},data={'settings':'{"name":"Test"}'})
    assert r.status_code==422


def test_invalid_creator(audio_sample):
    r=req(audio_sample,extra={'creator_id':'not-an-id'})
    assert r.status_code==422


def test_upload_success_mock(audio_sample, monkeypatch):
    operations=[]
    def handler(req):
        assert req.headers.get('x-api-key')=='testing_key_123456789'
        if req.method=='POST':
            assert req.url.path=='/assets/v1/assets'
            assert b'"assetType": "Audio"' in req.content
            return httpx.Response(200,json={'path':'operations/MyJob001'})
        assert req.url.path=='/assets/v1/operations/MyJob001'
        operations.append(1)
        return httpx.Response(200,json={'path':'operations/MyJob001','done':True,'response':{
            'assetId':'888777666','moderationResult':{'moderationState':'MODERATION_STATE_PENDING'}}})
    original=httpx.AsyncClient
    monkeypatch.setattr(app.httpx,'AsyncClient',lambda **kw: original(transport=httpx.MockTransport(handler),**kw))
    r=req(audio_sample)
    assert r.status_code==200, r.text
    assert r.json()['assetId']=='888777666'
    assert r.json()['status']=='uploaded'
    assert operations


def test_roblox_operation_error():
    assert app.operation_result({'done':True,'error':{'message':'Rejected'}})['status']=='failed'
    assert app.operation_result({'path':'operations/AB'})['status']=='processing'
