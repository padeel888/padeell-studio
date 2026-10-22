'use strict';
const $ = (id) => document.getElementById(id);
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bytes = n => n >= 1048576 ? (n/1048576).toFixed(1)+' MB' : (n/1024).toFixed(0)+' KB';
const clock = n => n > 0 ? `${Math.floor(n/60)}:${String(Math.round(n%60)).padStart(2,'0')}` : '—';
const makeID = () => crypto.randomUUID();
const defaultEdit = name => ({name,trim_start:0,trim_end:0,volume:100,pitch:0,speed:1,normalize:false,fade:true});
const rows = [];
let selectedID = null, uploading = false, paused = false, key = '', creator = {type:'user',id:''};
let toastTimer;
let history = [];
try { history = JSON.parse(localStorage.getItem('padeelHistoryV2')||'[]'); if(!Array.isArray(history)) history=[]; }catch{history=[];}
const persist = () => {try{localStorage.setItem('padeelHistoryV2',JSON.stringify(history.slice(0,2000)));}catch{notify('Penyimpanan browser penuh. Ekspor CSV sebagai cadangan.');}};
function notify(message) { $('toast').textContent=message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4400); }
function trackStatus(r) {return ({queued:'Antre',processing:'Diproses',uploaded:'Berhasil',failed:'Gagal'})[r.status]||r.status;}
function activeRows(){const checked=rows.filter(r=>r.checked&&r.status!=='uploaded'&&r.status!=='processing');return checked.length?checked:rows.filter(r=>r.status!=='uploaded'&&r.status!=='processing');}
function setTab(tab){document.querySelectorAll('.tab').forEach(x=>x.hidden=x.id!==tab+'Tab');document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));if(tab==='library')renderLibrary();}
document.querySelectorAll('[data-tab]').forEach(x=>x.addEventListener('click',()=>setTab(x.dataset.tab)));
const stripExt = name => name.replace(/\.(mp3|ogg|flac|wav)$/i,'');
function readDuration(file){return new Promise(resolve=>{const audio=new Audio(),url=URL.createObjectURL(file);let finished=false;const done=(v)=>{if(finished)return;finished=true; audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);resolve(v);};audio.preload='metadata';audio.onloadedmetadata=()=>done(Number.isFinite(audio.duration)?audio.duration:0);audio.onerror=()=>done(0);audio.src=url;setTimeout(()=>done(0),10000);});}
async function addFiles(files){const remaining=150-rows.length; if(remaining<=0){notify('Batch sudah mencapai 150 audio.');return;}
  const accepted=Array.from(files).filter(f=>/\.(mp3|wav|ogg|flac)$/i.test(f.name)&&f.size>0&&f.size<=50*1024*1024);
  const additions=accepted.slice(0,remaining);
  for(const file of additions){const row={id:makeID(),file,duration:0,checked:false,edit:defaultEdit(stripExt(file.name)),status:'queued',assetId:'',operation:'',message:''};rows.push(row);}
  renderQueue(); notify(`${additions.length} audio ditambahkan${accepted.length>remaining?' (maksimum 150)':''}.`);
  await Promise.all(additions.map(async r=>{r.duration=await readDuration(r.file);renderQueue();}));
}
$('addFiles').onclick=()=> $('fileInput').click();
$('fileInput').addEventListener('change',async e=>{await addFiles(e.target.files);e.target.value='';});
const dropZone=$('dropZone');dropZone.ondragover=e=>{e.preventDefault();dropZone.classList.add('dragging');};dropZone.ondragleave=()=>dropZone.classList.remove('dragging');dropZone.ondrop=async e=>{e.preventDefault();dropZone.classList.remove('dragging');await addFiles(e.dataTransfer.files);};
function renderQueue(){const done=rows.filter(x=>x.status==='uploaded').length,fail=rows.filter(x=>x.status==='failed').length;
  $('mTotal').textContent=String(rows.length).padStart(3,'0');$('mDone').textContent=String(done).padStart(3,'0');$('mFail').textContent=String(fail).padStart(3,'0');$('queueCount').textContent=`(${rows.length})`;
  $('queueBody').innerHTML=rows.length?rows.map(r=>`<tr data-row="${r.id}"><td><input data-check="${r.id}" type="checkbox" ${r.checked?'checked':''} ${r.status==='processing'?'disabled':''}></td><td><div class="track-name" title="${escapeHTML(r.edit.name)}">${escapeHTML(r.edit.name)}</div><small class="track-sub" title="${escapeHTML(r.file.name)}">${escapeHTML(r.file.name)}</small></td><td>${clock(r.duration)}</td><td>${bytes(r.file.size)}</td><td><span class="tag ${escapeHTML(r.status)}" title="${escapeHTML(r.message)}">${trackStatus(r)}</span></td><td>${r.assetId?`<button class="action-btn" data-copy="${r.id}" title="Salin Asset ID">${escapeHTML(r.assetId)} ⧉</button>`:'—'}</td><td><button class="action-btn" data-edit="${r.id}">Edit</button>${r.status==='processing'&&r.operation?` <button class="action-btn" data-poll="${r.id}">Cek status</button>`:''}${r.status==='failed'?` <button class="action-btn" data-retry="${r.id}">Retry</button>`:''}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">Belum ada audio. Tambahkan audio untuk memulai.</td></tr>';
  const processed=done+fail; $('progressBar').style.width=rows.length?`${(processed/rows.length)*100}%`:'0%';$('progressText').textContent=`${processed} dari ${rows.length} selesai`;
  $('checkAll').checked=rows.length>0 && rows.every(r=>r.checked);
  $('uploadAll').disabled=uploading||!rows.some(r=>r.status==='queued'||r.status==='failed');$('pauseBtn').disabled=!uploading;
  $('pauseBtn').textContent=paused?'Lanjutkan':'Jeda';$('navCount').textContent=history.filter(h=>h.status==='uploaded').length;
}
$('queueBody').addEventListener('change',e=>{const id=e.target.dataset.check;if(!id)return;const r=rows.find(x=>x.id===id);if(r)r.checked=e.target.checked;renderQueue();});
$('queueBody').addEventListener('click',async e=>{const el=e.target.closest('button');if(!el)return;
  const id=el.dataset.edit||el.dataset.copy||el.dataset.retry||el.dataset.poll,r=rows.find(x=>x.id===id);if(!r)return;
  if(el.dataset.edit)selectRow(id);
  if(el.dataset.copy){await navigator.clipboard.writeText(r.assetId);notify('Asset ID disalin.');}
  if(el.dataset.retry){r.status='queued';r.message='';r.operation='';renderQueue();notify('Masuk antrean ulang. Tekan Upload antrean.');}
  if(el.dataset.poll)await pollRow(r);
});
$('selectAll').onclick=()=>{rows.forEach(r=>{if(r.status!=='processing')r.checked=true;});renderQueue();};
$('checkAll').onchange=e=>{rows.forEach(r=>{if(r.status!=='processing')r.checked=e.target.checked;});renderQueue();};
$('removeSelected').onclick=()=>{const removed=rows.filter(r=>r.checked&&r.status!=='processing');removed.forEach(r=>{if(r.previewURL)URL.revokeObjectURL(r.previewURL);});for(let i=rows.length-1;i>=0;i--)if(removed.includes(rows[i]))rows.splice(i,1);if(!rows.find(r=>r.id===selectedID))clearEditor();renderQueue();notify(`${removed.length} audio dihapus dari antrean.`);};
function applyBulk(){const active=activeRows();const prefix=$('prefix').value,suffix=$('suffix').value,vol=+$('bulkVolume').value,pitch=+$('bulkPitch').value,speed=+$('bulkSpeed').value,start=+$('bulkStart').value,end=+$('bulkEnd').value;
 if(![vol,pitch,speed,start,end].every(Number.isFinite)||vol<0||vol>200||pitch< -12||pitch>12||speed<.5||speed>2||start<0||end<0){notify('Periksa pengaturan massal yang diisi.');return;}
 active.forEach(r=>{r.edit={...r.edit,name:(prefix+r.edit.name+suffix).slice(0,120),trim_start:start,trim_end:end,volume:vol,pitch,speed,normalize:$('bulkNormalize').checked,fade:$('bulkFade').checked};});
 $('bulkInfo').textContent=`Diterapkan pada ${active.length} audio`;if(selectedID)selectRow(selectedID);renderQueue();notify(`${active.length} lagu selesai diatur.`);}
$('applyBulk').onclick=applyBulk;$('resetBulk').onclick=()=>{['prefix','suffix'].forEach(k=>$(k).value='');$('bulkVolume').value=100;$('bulkPitch').value=0;$('bulkSpeed').value=1;$('bulkStart').value=0;$('bulkEnd').value=0;$('bulkNormalize').checked=false;$('bulkFade').checked=true;notify('Form massal direset.');};
function clearEditor(){selectedID=null;$('editorContent').hidden=true;$('editorEmpty').hidden=false;}
function selectRow(id){const r=rows.find(r=>r.id===id);if(!r)return;selectedID=id;$('editorEmpty').hidden=true;$('editorContent').hidden=false;
  const ids={editName:'name',editStart:'trim_start',editEnd:'trim_end',editVolume:'volume',editPitch:'pitch',editSpeed:'speed'};Object.entries(ids).forEach(([id,k])=>$(id).value=r.edit[k]);$('editNormalize').checked=r.edit.normalize;$('editFade').checked=r.edit.fade;
  if(!r.previewURL)r.previewURL=URL.createObjectURL(r.file);$('audioPlayer').src=r.previewURL;$('editStatus').textContent=r.status==='uploaded'?'File yang diunggah tidak bisa diubah; edit hanya untuk upload baru.':'Preview biasa memutar file asli.';
  const disabled=r.status==='uploaded'||r.status==='processing';Object.keys(ids).forEach(k=>$(k).disabled=disabled);$('editNormalize').disabled=disabled;$('editFade').disabled=disabled;$('saveEdit').disabled=disabled;$('downloadEdit').disabled=disabled;$('previewEdit').disabled=disabled;
}
function editorValues(){return {name:$('editName').value.trim(),trim_start:+$('editStart').value,trim_end:+$('editEnd').value,volume:+$('editVolume').value,pitch:+$('editPitch').value,speed:+$('editSpeed').value,normalize:$('editNormalize').checked,fade:$('editFade').checked};}
function validateEdit(v){return v.name&&v.name.length<=120&&v.trim_start>=0&&v.trim_end>=0&&v.volume>=0&&v.volume<=200&&v.pitch>=-12&&v.pitch<=12&&v.speed>=.5&&v.speed<=2&&Object.values(v).filter(x=>typeof x==='number').every(Number.isFinite);}
function saveEditor(){const r=rows.find(x=>x.id===selectedID);if(!r||r.status==='uploaded'||r.status==='processing')return false;const v=editorValues();if(!validateEdit(v)){notify('Pengaturan audio tidak valid.');return false;}r.edit=v;renderQueue();$('editStatus').textContent='Perubahan disimpan.';return true;}
$('saveEdit').onclick=()=>{if(saveEditor())notify('Pengaturan lagu disimpan.');};
async function renderEdited(download){if(!saveEditor())return;const r=rows.find(x=>x.id===selectedID),btn=$(download?'downloadEdit':'previewEdit');btn.disabled=true;$('editStatus').textContent='Sedang mengonversi…';
  try {const f=new FormData();f.append('file',r.file,r.file.name);f.append('settings',JSON.stringify(r.edit));const response=await fetch('/api/convert',{method:'POST',body:f});const data=await response.blob();if(!response.ok){let j={};try{j=JSON.parse(await data.text());}catch{}throw Error(j.detail||`HTTP ${response.status}`);}
    const url=URL.createObjectURL(data);if(download){const a=document.createElement('a');a.href=url;a.download=r.edit.name+'.mp3';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('editStatus').textContent='MP3 selesai diekspor.';}else{if(r.editedURL)URL.revokeObjectURL(r.editedURL);r.editedURL=url;$('audioPlayer').src=url;await $('audioPlayer').play().catch(()=>{});$('editStatus').textContent='Memutar hasil edit (MP3).';}
  }catch(e){$('editStatus').textContent=e.message||'Konversi gagal';}finally{btn.disabled=false;}}
$('previewEdit').onclick=()=>renderEdited(false);$('downloadEdit').onclick=()=>renderEdited(true);
$('connectBtn').onclick=()=>$('connectionDialog').showModal();$('saveConnection').addEventListener('click',e=>{const k=$('apiKey').value.trim(),id=$('creatorId').value.trim();if(k.length<12||!/^[1-9]\d{0,19}$/.test(id)){e.preventDefault();notify('Isi API key dan User ID/Group ID valid.');return;}key=k;creator={type:$('creatorType').value,id};$('accountLabel').textContent=`${creator.type==='user'?'User':'Group'} #${id}`;$('accountDot').style.background='#8fcba0';notify('Koneksi disetel. Izin key diperiksa Roblox saat upload.');});
function record(r){history=history.filter(h=>h.queueID!==r.id);history.unshift({queueID:r.id,name:r.edit.name,assetId:r.assetId||'',duration:r.resultDuration||r.duration,status:r.status,operation:r.operation||'',moderation:r.moderation||'',message:r.message||'',created:new Date().toISOString()});persist();renderLibrary();}
async function pollRow(r){if(!key){notify('Atur API key terlebih dahulu.');return;}if(!r.operation){notify('Operation ID tidak ada.');return;}
  try{const id=r.operation.split('/').pop();const response=await fetch('/api/operations/'+encodeURIComponent(id),{headers:{'X-Roblox-API-Key':key}});const j=await response.json();if(!response.ok)throw Error(j.detail||'Gagal memeriksa status');r.status=j.status||'processing';r.assetId=j.assetId||r.assetId;r.message=j.message||'';r.moderation=j.moderation||'';if(r.status!=='processing')record(r);renderQueue();notify(r.status==='processing'?'Roblox masih memproses audio.':`Status: ${trackStatus(r)}`);}catch(e){r.message=e.message;renderQueue();notify(e.message);}}
async function uploadOne(r){r.status='processing';r.message='Mengedit audio & mengunggah…';renderQueue();try{const f=new FormData();f.append('file',r.file,r.file.name);f.append('settings',JSON.stringify(r.edit));f.append('creator_type',creator.type);f.append('creator_id',creator.id);
  const response=await fetch('/api/upload',{method:'POST',headers:{'X-Roblox-API-Key':key},body:f});const j=await response.json();if(!response.ok){const err=Error(typeof j.detail==='string'?j.detail:`HTTP ${response.status}`);err.status=response.status;throw err;}
  r.status=j.status||'failed';r.assetId=j.assetId||'';r.operation=j.operation||'';r.moderation=j.moderation||'';r.resultDuration=j.duration||r.duration;r.message=j.message|| (r.status==='processing'?'Roblox masih memproses; klik Cek status.':'');record(r);
 }catch(e){r.status='failed';r.message=e.message||'Upload gagal';record(r);if(e.status===429 || (e.status===403 && /kuota|quota|limit|exceed/i.test(e.message))){paused=true;notify('Roblox membatasi upload; antrean dijeda.');}}
 renderQueue();}
$('uploadAll').onclick=async()=>{if(uploading)return;if(!key||!creator.id){$('connectionDialog').showModal();notify('Setel API key dan pemilik asset dahulu.');return;}if(!$('rights').checked){notify('Konfirmasi hak penggunaan audio sebelum mengunggah.');return;}
 const pending=rows.filter(r=>r.status==='queued'||r.status==='failed');if(!pending.length)return;uploading=true;paused=false;renderQueue();let cursor=0;
 const worker=async()=>{while(cursor<pending.length){while(paused)await new Promise(resolve=>setTimeout(resolve,350));const r=pending[cursor++];if(!r)break;await uploadOne(r);}};
 try{await Promise.all([worker(),worker()]);notify('Antrean selesai. Periksa library dan status moderasi Roblox.');}finally{uploading=false;paused=false;renderQueue();}};
$('pauseBtn').onclick=()=>{paused=!paused;renderQueue();notify(paused?'Dijeda. Upload yang sedang berjalan tetap diproses.':'Antrean dilanjutkan.');};
function renderLibrary(){const query=$('libSearch').value.toLowerCase(),filter=$('libFilter').value;const data=history.filter(h=>(filter==='all'||h.status===filter)&&(`${h.name} ${h.assetId}`).toLowerCase().includes(query));
 $('libBody').innerHTML=data.length?data.map(h=>`<tr><td><div class="track-name" title="${escapeHTML(h.name)}">${escapeHTML(h.name)}</div></td><td>${h.assetId?`<code>${escapeHTML(h.assetId)}</code>`:'—'}</td><td>${clock(h.duration)}</td><td><span class="tag ${escapeHTML(h.status)}" title="${escapeHTML(h.message||h.moderation)}">${trackStatus(h)}</span></td><td>${new Date(h.created).toLocaleString('id-ID')}</td><td>${h.assetId?`<button class="action-btn" data-copyid="${escapeHTML(h.assetId)}">Salin ID</button> <button class="action-btn" data-copyrbx="${escapeHTML(h.assetId)}">rbxassetid</button>`:(h.status==='processing'&&h.operation?`<button class="action-btn" data-checkop="${escapeHTML(h.queueID)}">Cek status</button>`:'—')}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">Tidak ada hasil untuk filter ini.</td></tr>';
 $('navCount').textContent=history.filter(h=>h.status==='uploaded').length;
}
$('libBody').onclick=async e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.checkop){const h=history.find(h=>h.queueID===b.dataset.checkop);if(!h)return;if(!key){notify('Masukkan API key Roblox lagi untuk memeriksa status.');$('connectionDialog').showModal();return;}
    try{const opid=h.operation.split('/').pop();const response=await fetch('/api/operations/'+encodeURIComponent(opid),{headers:{'X-Roblox-API-Key':key}});const j=await response.json();if(!response.ok)throw Error(j.detail||'Gagal cek status');h.status=j.status||h.status;h.assetId=j.assetId||h.assetId;h.message=j.message||'';h.moderation=j.moderation||'';persist();const r=rows.find(x=>x.id===h.queueID);if(r){r.status=h.status;r.assetId=h.assetId;r.message=h.message;}renderQueue();renderLibrary();notify('Status Roblox diperbarui.');}catch(err){notify(err.message);}return;
  }
  const id=b.dataset.copyid||b.dataset.copyrbx;if(id){await navigator.clipboard.writeText(b.dataset.copyrbx?'rbxassetid://'+id:id);notify('ID disalin.');}};
$('libSearch').oninput=renderLibrary;$('libFilter').onchange=renderLibrary;
$('csvBtn').onclick=()=>{const cols=['Nama lagu','Asset ID','rbxassetid','Durasi detik','Status','Moderasi','Operation','Waktu'];const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const lines=[cols,...history.map(h=>[h.name,h.assetId,h.assetId?'rbxassetid://'+h.assetId:'',h.duration,h.status,h.moderation,h.operation,h.created])];
 const blob=new Blob(['\ufeff'+lines.map(r=>r.map(esc).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Padeel-Studio-Asset-Library.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),20000);};
$('copyAll').onclick=async()=>{const ids=history.filter(h=>h.assetId).map(h=>`${h.name} — rbxassetid://${h.assetId}`);if(!ids.length){notify('Belum ada ID untuk disalin.');return;}await navigator.clipboard.writeText(ids.join('\n'));notify(`${ids.length} nama dan ID disalin.`);};
renderQueue();renderLibrary();
