(async function(){
  // helpers
  const $ = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
  const fmt = x => (x==null?'':String(x));

  async function getList(){ const {boycottList=[]}=await chrome.storage.local.get('boycottList'); return boycottList; }
  async function setList(list){ await chrome.storage.local.set({boycottList:list}); }
  async function getWhitelist(){ const {whitelist=[]}=await chrome.storage.local.get('whitelist'); return whitelist; }
  async function setWhitelist(wl){ await chrome.storage.local.set({whitelist:wl}); }
  async function getSupporter(){ const {supporter=false}=await chrome.storage.local.get('supporter'); return !!supporter; }
  async function setSupporter(v){ await chrome.storage.local.set({supporter:!!v}); }

  // UI state
  let list=[], wl=[], supporter=false;

  function renderList(){
    $('#count-list').textContent = `(${list.length})`;
    const tb=$('#tbl-list tbody'); tb.innerHTML='';
    list.forEach(item=>{
      const tr=document.createElement('tr');
      const srcName=fmt(item.source?.name||''); const srcUrl=fmt(item.source?.url||'');
      const aliases=(item.brand_aliases||[]).map(a=>`<span class="pill">${a}</span>`).join(' ');
      tr.innerHTML=`
        <td><strong>${fmt(item.name||item.label||item.id)}</strong><br><small class="muted">${fmt(item.category||'')}</small></td>
        <td><div><code>${fmt(item.pattern)}</code></div><div style="margin-top:4px">${aliases}</div></td>
        <td><div>${srcName?`<strong>${srcName}</strong>`:''}${srcUrl?`<br><a href="${srcUrl}" target="_blank">${srcUrl}</a>`:''}</div></td>
        <td>
          <button class="btn btn-edit">Edit</button>
          <button class="btn btn-del">Remove</button>
        </td>`;
      tr.querySelector('.btn-edit').onclick=()=>openEdit(item);
      tr.querySelector('.btn-del').onclick=()=>{ list=list.filter(x=>x.id!==item.id); setList(list).then(renderList).then(notify); };
      tb.appendChild(tr);
    });
  }

  function renderWl(){
    $('#count-wl').textContent = `(${wl.length})`;
    const tb=$('#tbl-wl tbody'); tb.innerHTML='';
    wl.forEach(w=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${fmt(w.label||w.id)}</td>
        <td><button class="btn btn-del">Remove</button></td>`;
      tr.querySelector('.btn-del').onclick=()=>{ wl=wl.filter(x=>x.id!==w.id); setWhitelist(wl).then(renderWl).then(notify); };
      tb.appendChild(tr);
    });
  }

  function openDialog(title, bodyHtml, onOk){
    $('#dlg-title').textContent=title;
    $('#dlg-body').innerHTML=bodyHtml;
    $('#dlg').style.display='flex';
    $('#dlg-x').onclick=$('#dlg-cancel').onclick=()=>$('#dlg').style.display='none';
    $('#dlg-ok').onclick=async ()=>{
      try{ await onOk(); }finally{ $('#dlg').style.display='none'; }
    };
  }

  function openEdit(item){
    const it = JSON.parse(JSON.stringify(item));
    openDialog('Edit item', `
      <div class="row" style="padding:0">
        <div class="col" style="min-width:300px">
          <label>Name<br><input id="f-name" type="text" value="${fmt(it.name||'')}"></label><br><br>
          <label>Pattern (exact string or regex)<br><input id="f-pattern" type="text" value="${fmt(it.pattern||'')}"></label><br><br>
          <label>Aliases/brands (comma-separated)<br><input id="f-aliases" type="text" value="${fmt((it.brand_aliases||[]).join(', '))}"></label><br><br>
          <label>Category<br><input id="f-cat" type="text" value="${fmt(it.category||'')}"></label><br><br>
        </div>
        <div class="col" style="min-width:300px">
          <label>Tie statement (banner)<br><textarea id="f-tie">${fmt(it.tie_statement||'')}</textarea></label><br>
          <label>Explanation (details modal)<br><textarea id="f-expl">${fmt(it.explanation||'')}</textarea></label><br>
          <label>Alternative<br><input id="f-alt" type="text" value="${fmt(it.alternative||'')}"></label><br><br>
          <label>Source name<br><input id="f-srcname" type="text" value="${fmt(it.source?.name||'')}"></label><br>
          <label>Source URL<br><input id="f-srcurl" type="text" value="${fmt(it.source?.url||'')}"></label><br>
        </div>
      </div>
    `, async ()=>{
      it.name = $('#f-name').value.trim();
      it.pattern = $('#f-pattern').value.trim();
      it.brand_aliases = ($('#f-aliases').value||'').split(',').map(s=>s.trim()).filter(Boolean);
      it.category = $('#f-cat').value.trim();
      it.tie_statement = $('#f-tie').value.trim();
      it.explanation = $('#f-expl').value.trim();
      it.alternative = $('#f-alt').value.trim();
      it.source = { name: $('#f-srcname').value.trim(), url: $('#f-srcurl').value.trim() };

      const idx = list.findIndex(x=>x.id===item.id);
      if (idx>=0) list[idx]=it;
      await setList(list); renderList(); notify();
    });
  }

  function openAdd(){
    const it = { id: crypto.randomUUID(), name:'', pattern:'', brand_aliases:[], source:{} };
    openDialog('Add item', `
      <label>Name<br><input id="f-name" type="text"></label><br><br>
      <label>Pattern (exact string or regex)<br><input id="f-pattern" type="text"></label><br><br>
      <label>Aliases/brands (comma-separated)<br><input id="f-aliases" type="text"></label><br><br>
      <label>Category<br><input id="f-cat" type="text"></label><br><br>
      <label>Tie statement<br><textarea id="f-tie"></textarea></label><br>
      <label>Explanation<br><textarea id="f-expl"></textarea></label><br>
      <label>Alternative<br><input id="f-alt" type="text"></label><br><br>
      <label>Source name<br><input id="f-srcname" type="text"></label><br>
      <label>Source URL<br><input id="f-srcurl" type="text"></label><br>
    `, async ()=>{
      it.name = $('#f-name').value.trim();
      it.pattern = $('#f-pattern').value.trim();
      it.brand_aliases = ($('#f-aliases').value||'').split(',').map(s=>s.trim()).filter(Boolean);
      it.category = $('#f-cat').value.trim();
      it.tie_statement = $('#f-tie').value.trim();
      it.explanation = $('#f-expl').value.trim();
      it.alternative = $('#f-alt').value.trim();
      it.source = { name: $('#f-srcname').value.trim(), url: $('#f-srcurl').value.trim() };

      if (!it.name || !it.pattern) { alert('Name and Pattern are required.'); return; }
      list.push(it);
      await setList(list); renderList(); notify();
    });
  }

  // notify content scripts to rescan
  function notify(){
    chrome.tabs.query({}, tabs => {
      tabs.forEach(t => { if (t.id >= 0) chrome.tabs.sendMessage(t.id, {type:'blacklistUpdated'}).catch(()=>{}); });
    });
  }

  // Donation buttons in Admin header
  function renderDonateButtons(){
    const host = $('#donate-bar');
    if (!host) return;
    // clear existing anchors (keep the "Support:" label)
    $$('#donate-bar a').forEach(a=>a.remove());

    chrome.runtime.sendMessage({type:'getConfig'}, resp=>{
      const d = (resp && resp.ok && resp.config && resp.config.donations) || { "5":"#", "20":"#", "50":"#", "100":"#", "custom":"#" };
      const mk = (label, key) => {
        const a=document.createElement('a');
        a.className='btn';
        a.textContent=label;
        a.href=d[key]||'#'; a.target='_blank'; a.rel='noopener noreferrer';
        return a;
      };
      host.append(mk('$5','5'), mk('$20','20'), mk('$50','50'), mk('$100','100'), mk('Custom','custom'));
    });
  }

  // wiring
  $('#btn-add').onclick = openAdd;

  $('#btn-export').onclick = async ()=>{
    const data = await getList();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='ybl-boycott-list.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  };

  $('#file-import').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if (!f) return;
    try{
      const text = await f.text();
      const json = JSON.parse(text);
      if (!Array.isArray(json)) throw new Error('Expected an array');
      list = json;
      await setList(list); renderList(); notify();
    }catch(err){ alert('Import failed: '+err.message); }
    e.target.value='';
  });

  $('#btn-seed').onclick = async ()=>{
    await chrome.runtime.sendMessage({type:'refreshSeed'});
    list = await getList();
    renderList(); notify();
  };

  $('#supporter').addEventListener('change', e=>{
    setSupporter(e.target.checked);
  });

  // init
  list = await getList();
  wl = await getWhitelist();
  supporter = await getSupporter();
  $('#supporter').checked = supporter;
  renderList(); renderWl(); renderDonateButtons();
})();
