const $ = id => document.getElementById(id);
let selected = null;

function setStatus(msg,bad=false){$("status").textContent=msg;$("status").style.color=bad?"#ff7288":"#9da8b4"}
function keychain(){return window.hive_keychain||null}

function checkKeychain(){
  const kc=keychain();
  if(!kc){setStatus("Hive Keychain was not detected in this browser.",true);return}
  kc.requestHandshake(()=>setStatus("Hive Keychain detected."))
}
$("handshakeBtn").onclick=checkKeychain;
$("connectBtn").onclick=()=>{location.hash="join";checkKeychain()};

$("searchBtn").onclick=searchPlaces;
$("placeQuery").addEventListener("keydown",e=>{if(e.key==="Enter")searchPlaces()});

async function searchPlaces(){
  const q=$("placeQuery").value.trim();
  if(q.length<2)return;
  $("results").innerHTML='<div class="muted">Searching…</div>';
  try{
    const url="https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q="+encodeURIComponent(q);
    const res=await fetch(url,{headers:{"Accept-Language":"en"}});
    const data=await res.json();
    $("results").innerHTML="";
    data.forEach(p=>{
      const a=p.address||{};
      const city=a.city||a.town||a.village||a.municipality||a.hamlet||p.name;
      const country=a.country||"";
      const countryCode=(a.country_code||"").toUpperCase();
      const region=a.state||a.region||a.county||"";
      const div=document.createElement("div");
      div.className="result";
      div.textContent=p.display_name;
      div.onclick=()=>choosePlace({city,country,countryCode,region,lat:+p.lat,lon:+p.lon,label:p.display_name});
      $("results").appendChild(div)
    });
    if(!data.length)$("results").innerHTML='<div class="muted">No places found.</div>'
  }catch(e){$("results").innerHTML='<div class="muted">Search failed. Try again.</div>'}
}

function choosePlace(p){
  selected=p;
  $("selection").classList.remove("hidden");
  $("selection").innerHTML=`<strong>${escapeHtml(p.city)}</strong><br><span class="muted">${escapeHtml(p.region)} · ${escapeHtml(p.country)} · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>`;
  $("jsonPreview").textContent=JSON.stringify(censusPayload(),null,2);
  map.setView([p.lat,p.lon],9);
  L.marker([p.lat,p.lon]).addTo(map).bindPopup(escapeHtml(p.city)).openPopup()
}

function censusPayload(){
  return{v:1,action:"set",country:selected.countryCode,region:selected.region,city:selected.city,lat:+selected.lat.toFixed(5),lon:+selected.lon.toFixed(5)}
}

/* Safety switch for v0.2:
   real Hive publishing stays disabled until Protocol v1.0 is explicitly frozen. */
$("publishBtn").onclick=()=>setStatus("Publishing is intentionally disabled in v0.2 until Protocol v1.0 is frozen.",true);

function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

const map=L.map("mapCanvas",{worldCopyJump:true,zoomControl:true}).setView([28,12],2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
