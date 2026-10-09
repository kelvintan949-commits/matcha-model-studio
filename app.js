import * as THREE from 'three';
import {OrbitControls} from './assets/OrbitControls.js';
import {buildWallCutaway, wallFacesCamera} from './cutaway.mjs';
import {ArchitecturalRenderer,createSurfaceDetail,finishProfile} from './realism.mjs';
import {AC_BOUNDS,SPAWN,canStand,moveOnPlan,walkingVector,QUALITY} from './navigation.mjs';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const viewport=$('#viewport'),host=$('#canvas-host');
const scene=new THREE.Scene();
const orbitCamera=new THREE.OrthographicCamera(-12,12,10,-10,.01,250);
const walkCamera=new THREE.PerspectiveCamera(68,1,.035,100);
let camera=orbitCamera,walking=false,freeLook=false,savedWalkState=null,yaw=Math.PI/2,pitch=0;
const mobileDevice=matchMedia('(pointer:coarse)').matches||Math.min(screen.width,screen.height)<600;
let qualityName=mobileDevice?'mobile':'balanced',quality=QUALITY[qualityName],dirty=true,shadowDirty=true;
let lastRender=0,lightRefresh=0,slowFrames=0,qualityChangedAt=0;
const keys=new Set(),touchKeys=new Map();let lookTouch=null;
const lightPool=[];
function invalidate(shadows=false){dirty=true;if(shadows){shadowDirty=true;lightRefresh=0;}}
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:false,powerPreference:mobileDevice?'low-power':'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,quality.dpr));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate=false;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
host.append(renderer.domElement);
const architecturalRenderer=new ArchitecturalRenderer(renderer);
const surfaceDetail=createSurfaceDetail();
const controls=new OrbitControls(orbitCamera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.minZoom=.35;controls.maxZoom=12;controls.maxPolarAngle=Math.PI*.495;
const modelRoot=new THREE.Group();scene.add(modelRoot);
const ambient=new THREE.HemisphereLight(0xfff7e9,0x75664f,.38);scene.add(ambient);
const sun=new THREE.DirectionalLight(0xffe4ba,3.15);sun.position.set(-3,7,8);sun.castShadow=true;sun.shadow.mapSize.set(quality.shadow,quality.shadow);sun.shadow.camera.left=-13;sun.shadow.camera.right=13;sun.shadow.camera.top=9;sun.shadow.camera.bottom=-9;sun.shadow.camera.near=.5;sun.shadow.camera.far=50;sun.shadow.radius=quality.shadow/1024*2.2;sun.shadow.normalBias=.006;sun.shadow.bias=-.0001;scene.add(sun);
const fill=new THREE.DirectionalLight(0xe8eeff,.22);fill.position.set(8,7,-6);scene.add(fill);
// A local studio environment keeps metallic finishes legible without remote dependencies.
const envScene=new THREE.Scene();envScene.background=new THREE.Color(0xc2b8a5);
for(const [p,s,c] of [[[0,6,0],[10,1,10],0xffffff],[[-8,2,0],[1,7,12],0xe3e8ef],[[8,2,0],[1,7,12],0xffedd7]]){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...s),new THREE.MeshBasicMaterial({color:c}));mesh.position.set(...p);envScene.add(mesh);}
const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(envScene,.025).texture;pmrem.dispose();
const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshStandardMaterial({color:0xc6bdac,roughness:.97,metalness:0,envMapIntensity:.35}));ground.rotation.x=-Math.PI/2;ground.position.y=-.07;ground.receiveShadow=true;scene.add(ground);scene.background=new THREE.Color(0xd5cfc3);
let data,buffer,objects=[],selected=null,isolated=null,explodeTarget=0,explode=0,mode='interior',dimensionsOn=true,evening=false,acObject,doorObject,chairObjects=[],lightObjects=[],toastTimer;
let projectionHeight=15,frameTime=performance.now();
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),pickMeshes=[],labels=[];
const textureCache=new Map();
const materialCache=new Map(),textureLoader=new THREE.TextureLoader();
const selectionBox=new THREE.Box3Helper(new THREE.Box3(),0x789c50);selectionBox.material.depthTest=false;selectionBox.material.depthWrite=false;selectionBox.material.transparent=true;selectionBox.material.opacity=.7;selectionBox.visible=false;selectionBox.renderOrder=12;scene.add(selectionBox);
const hidden=new Set(),state={wall:true,floor:true,ceiling:false,interior:true};
const motionReduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const cutawayDirection=new THREE.Vector3();

function updateCameraCutaway(){
 camera.getWorldDirection(cutawayDirection).negate();
 const direction=[cutawayDirection.x,cutawayDirection.y,cutawayDirection.z];
 let changed=false;
 for(const o of objects){
  if(!o.wallCutaway)continue;
  const next=wallFacesCamera(o.wallCutaway.normal,direction,o.autoHidden);
  if(next!==o.autoHidden){o.autoHidden=next;changed=true;}
 }
 if(changed&&mode==='interior')updateVisibility();
}
controls.addEventListener('change',()=>{invalidate();if(!walking)updateCameraCutaway();});

function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2500);}
function resize(){let w=host.clientWidth,h=Math.max(1,host.clientHeight);renderer.setSize(w,h);orbitCamera.left=-projectionHeight*w/h/2;orbitCamera.right=-orbitCamera.left;orbitCamera.top=projectionHeight/2;orbitCamera.bottom=-orbitCamera.top;orbitCamera.updateProjectionMatrix();walkCamera.aspect=w/h;walkCamera.updateProjectionMatrix();architecturalRenderer.resize(w*renderer.getPixelRatio(),h*renderer.getPixelRatio());invalidate();}
new ResizeObserver(()=>{resize();if(data&&objects.length&&!walking)frame();}).observe(host);
function frame(view='iso',focus=null){
 if(walking)exitWalk();invalidate();
 const center=focus?new THREE.Box3().setFromObject(focus.group).getCenter(new THREE.Vector3()):new THREE.Vector3(0,explodeTarget>0?2.5:1.2,0);
 controls.target.copy(center);const direction=view==='top'?new THREE.Vector3(.001,1,0):view==='front'?new THREE.Vector3(1,.02,.001):new THREE.Vector3(1,1.05,1.35);
 camera.position.copy(center).add(direction.normalize().multiplyScalar(35));camera.zoom=1;controls.update();camera.lookAt(center);camera.updateMatrixWorld();
 const bounds=focus?new THREE.Box3().setFromObject(focus.group):new THREE.Box3(new THREE.Vector3(-8.4,explodeTarget>0?-1.8:-.2,-3.6),new THREE.Vector3(8.8,explodeTarget>0?7.8:4,3.7));
 const projected=new THREE.Box3();for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
 const size=projected.getSize(new THREE.Vector3()),aspect=host.clientWidth/host.clientHeight;
 projectionHeight=Math.max(size.y*1.35,size.x/aspect*1.2,focus?2:8);resize();controls.update();
}

function mapTexture(cfg,kind,source){
 const key=kind+JSON.stringify(cfg);if(textureCache.has(key))return textureCache.get(key);let t;
 if(cfg.file){t=textureLoader.load(cfg.file,texture=>{
  const image=texture.image,limit=mobileDevice?1024:2048;
  if(Math.max(image.width,image.height)>limit){const canvas=document.createElement('canvas'),scale=limit/Math.max(image.width,image.height);canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);texture.image=canvas;texture.needsUpdate=true;}
  invalidate(true);
 });t.colorSpace=kind==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace;}
 else if(cfg.procedural==='tile'){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle='#555';ctx.fillRect(0,0,256,256);ctx.fillStyle='#aaa';const gx=Math.max(1,256*.003/(cfg.scale[0]*.3048)/2),gy=Math.max(1,256*.003/(cfg.scale[1]*.3048)/2);ctx.fillRect(gx,gy,256-2*gx,256-2*gy);t=new THREE.CanvasTexture(canvas);
 }
 if(!t)return null;
 t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/cfg.scale[0],1/cfg.scale[1]);t.offset.set(-cfg.offset[0]/cfg.scale[0],-cfg.offset[1]/cfg.scale[1]);t.rotation=cfg.rotation*Math.PI/180;t.anisotropy=Math.min(mobileDevice?2:8,renderer.capabilities.getMaxAnisotropy());textureCache.set(key,t);return t;
}
function material(id,instance){const key=id+(instance?':'+instance:'');if(materialCache.has(key))return materialCache.get(key);const source=data.materials[id]||{color:[180,180,175],opacity:1,roughness:.65};
 const profile=finishProfile(source);
 const mat=new THREE.MeshStandardMaterial({color:new THREE.Color(...source.color.map(c=>c/255)).convertSRGBToLinear(),roughness:profile.roughness,metalness:source.metalness||0,transparent:source.opacity<1,opacity:source.opacity,side:THREE.DoubleSide,envMapIntensity:.6});
 if(source.maps?.color?.file){mat.map=mapTexture(source.maps.color,'color',source);const tint=new THREE.Color(...source.color.map(c=>c/255)).convertSRGBToLinear(),fade=source.maps.color.fade??1;mat.color.set(0xffffff);mat.onBeforeCompile=shader=>{shader.uniforms.revitTint={value:tint};shader.uniforms.revitFade={value:fade};shader.fragmentShader='uniform vec3 revitTint; uniform float revitFade;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n diffuseColor.rgb = mix(revitTint, diffuseColor.rgb, revitFade);');};mat.customProgramCacheKey=()=>id;}
 if(source.maps?.bump&&!/Physical Wall Joints/i.test(source.name)){mat.bumpMap=mapTexture(source.maps.bump,'bump',source);mat.bumpScale=.0009;}
 else if(profile.wood&&source.maps?.color){mat.bumpMap=mapTexture(source.maps.color,'bump',source);mat.bumpScale=.0008;}
 else if(profile.detail){mat.bumpMap=surfaceDetail;mat.bumpScale=profile.detail;}
 if(source.maps?.gloss?.file){const t=mapTexture(source.maps.gloss,'gloss',source);mat.roughnessMap=t;const prior=mat.onBeforeCompile;mat.onBeforeCompile=shader=>{prior(shader);shader.fragmentShader=shader.fragmentShader.replace('roughnessFactor *= texelRoughness.g;','roughnessFactor *= (1.0 - texelRoughness.g);');};}
 if(source.emission>0){mat.emissive.setRGB(1,.65,.28);mat.emissiveIntensity=1.3;}
 mat.userData.source=id;mat.userData.baseEmission=mat.emissiveIntensity;materialCache.set(key,mat);return mat;}
function attribute(spec,size,ints=false){return new THREE.BufferAttribute(ints?new Uint32Array(buffer,spec[0],spec[1]):new Float32Array(buffer,spec[0],spec[1]),size);}
function makeMesh(m,e){const geom=new THREE.BufferGeometry();geom.setAttribute('position',attribute(m.position,3));geom.setAttribute('normal',attribute(m.normal,3));geom.setAttribute('uv',attribute(m.uv,2));geom.setIndex(attribute(m.index,1,true));geom.computeBoundingSphere();geom.computeBoundingBox();const mesh=new THREE.Mesh(geom,material(m.material,e.kind==='light'?e.id:null));mesh.castShadow=mesh.receiveShadow=true;mesh.userData.id=e.id;mesh.userData.sourceMaterial=m.material;mesh.userData.pose=m.pose;pickMeshes.push(mesh);return mesh;}
function centerOf(d){return new THREE.Vector3(...d.bounds[0]).add(new THREE.Vector3(...d.bounds[1])).multiplyScalar(.5);}
function createElement(d){const group=new THREE.Group();group.name=d.name;modelRoot.add(group);const o={d,group,center:centerOf(d),progress:d.initialState?1:0,target:d.initialState?1:0,leaves:[],lights:[],lightOn:d.kind==='light',slide:new THREE.Vector3()};
 if(d.kind==='door'){
  o.openGroup=new THREE.Group();o.closedGroup=new THREE.Group();group.add(o.openGroup,o.closedGroup);
  for(const leaf of d.leaves){const g=new THREE.Group();g.position.set(...leaf.center);o.closedGroup.add(g);o.leaves[leaf.index]={g,...leaf};}
  for(const m of d.meshes){const mesh=makeMesh(m,d);if(m.pose==='open')o.openGroup.add(mesh);else if(m.leaf>=0){const leaf=o.leaves[m.leaf];mesh.position.set(...leaf.center).negate();leaf.g.add(mesh);}else o.closedGroup.add(mesh);}
  doorObject=o;
 }else{for(const m of d.meshes)group.add(makeMesh(m,d));}
 if(d.kind==='light'){
  const isStrip=Math.max(d.bounds[1][0]-d.bounds[0][0],d.bounds[1][2]-d.bounds[0][2])>1;
  const l=new THREE.PointLight(0xffe5bd,isStrip?9:6.5,5.5,2);l.position.copy(o.center);l.position.y=d.bounds[0][1]-.08;o.lights.push(l);lightObjects.push(o);
 }if(d.kind==='chair')chairObjects.push(o);
 objects.push(o);return o;}
function createContactShadows(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');
 const gradient=ctx.createRadialGradient(32,32,3,32,32,32);gradient.addColorStop(0,'rgba(30,25,20,.32)');gradient.addColorStop(.55,'rgba(30,25,20,.15)');gradient.addColorStop(1,'rgba(30,25,20,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
 const map=new THREE.CanvasTexture(canvas),mat=new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,opacity:mobileDevice?.48:.28,polygonOffset:true,polygonOffsetFactor:-1});
 for(const o of objects.filter(o=>o.d.category==='Furniture')){const b=o.d.bounds,shadow=new THREE.Mesh(new THREE.PlaneGeometry((b[1][0]-b[0][0])*1.12,(b[1][2]-b[0][2])*1.12),mat);shadow.rotation.x=-Math.PI/2;shadow.position.set(o.center.x,.152,o.center.z);o.group.add(shadow);o.contact=shadow;}
}
function computeSlides(){const tables=objects.filter(o=>o.d.category==='Furniture'&&o.d.kind!=='chair');for(const o of chairObjects){const nearest=tables.reduce((best,t)=>{const dist=o.center.distanceToSquared(t.center);return !best||dist<best.dist?{t,dist}:best;},null)?.t;let dx=o.center.x-(nearest?.center.x??0),dz=o.center.z-(nearest?.center.z??0);if(Math.abs(dx)>Math.abs(dz))o.slide.set(Math.sign(dx)*.42,0,0);else o.slide.set(0,0,Math.sign(dz)*.42);}}
function createAC(){const d={id:'prototype-ac',name:'Wall-mounted AC',family:'Prototype concept unit',category:'Prototype AC',kind:'ac',layer:'interior',bounds:AC_BOUNDS,meshes:[]};
 const g=new THREE.Group();modelRoot.add(g);const o={d,group:g,center:centerOf(d),target:0,progress:0,lights:[],slide:new THREE.Vector3()};
 const shape=new THREE.Shape();shape.moveTo(-.435,-.145);shape.lineTo(.435,-.145);shape.lineTo(.435,.145);shape.lineTo(-.435,.145);shape.closePath();
 const casing=new THREE.ExtrudeGeometry(shape,{depth:.2,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.015,bevelThickness:.015});casing.translate(0,0,-.1);
 const body=new THREE.Mesh(casing,new THREE.MeshStandardMaterial({color:0xf1f0e9,roughness:.42,metalness:.06}));body.position.copy(o.center);body.castShadow=true;g.add(body);body.userData.id=d.id;pickMeshes.push(body);
 const vent=new THREE.Mesh(new THREE.BoxGeometry(.76,.06,.012),new THREE.MeshStandardMaterial({color:0x40514b,roughness:.6}));vent.position.copy(o.center).add(new THREE.Vector3(0,-.1,.12));g.add(vent);vent.userData.id=d.id;pickMeshes.push(vent);
 for(let i=0;i<3;i++){const slat=new THREE.Mesh(new THREE.BoxGeometry(.735,.005,.025),new THREE.MeshStandardMaterial({color:0xb7bdb7,roughness:.4}));slat.position.copy(o.center).add(new THREE.Vector3(0,-.121+i*.018,.127));slat.rotation.x=.2;g.add(slat);}
 const led=new THREE.Mesh(new THREE.BoxGeometry(.03,.011,.014),new THREE.MeshBasicMaterial({color:0x899a80}));led.position.copy(o.center).add(new THREE.Vector3(.31,.01,.121));g.add(led);o.led=led;
 o.air=new THREE.Group();g.add(o.air);
 for(let i=0;i<5;i++){let pts=[];for(let j=0;j<30;j++){const t=j/29;pts.push(new THREE.Vector3(o.center.x+(i-2)*.13+.02*Math.sin(t*6),o.center.y-.16-t*.55,o.center.z+.15+t*1.35));}const curve=new THREE.CatmullRomCurve3(pts);const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,30,.008,4,false),new THREE.MeshBasicMaterial({color:0x7ebdca,transparent:true,depthWrite:false,opacity:.45}));o.air.add(mesh);}
 o.air.visible=false;objects.push(o);acObject=o;
 const label=document.createElement('div');label.className='ac-label';label.textContent='AC / PROTOTYPE';$('#labels').append(label);labels.push({el:label,point:o.center.clone().add(new THREE.Vector3(0,.38,0)),owner:o,type:'ac'});
}
const dims=new THREE.Group();scene.add(dims);
function line(a,b,color=0x92a479){const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a),new THREE.Vector3(...b)]);const l=new THREE.Line(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity:.75,depthTest:false,depthWrite:false}));l.renderOrder=8;dims.add(l);}
function dimension(a,b,anchorA,anchorB,text,name){line(a,b);line(anchorA,a);line(anchorB,b);for(const p of [a,b])line([p[0]-.08,p[1]-.06,p[2]-.06],[p[0]+.08,p[1]+.06,p[2]+.06]);const el=document.createElement('div');el.className='dimension-label';el.innerHTML='<small>'+name+'</small>'+text+' m';$('#labels').append(el);labels.push({el,point:new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5),type:'dimension'});}
function createDimensions(){const [a,b]=data.bounds;dimension([a[0],-.15,b[2]+.9],[b[0],-.15,b[2]+.9],[a[0],0,b[2]],[b[0],0,b[2]],data.dimensions[0].toFixed(3),'L');dimension([b[0]+.9,-.15,a[2]],[b[0]+.9,-.15,b[2]],[b[0],0,a[2]],[b[0],0,b[2]],data.dimensions[2].toFixed(3),'W');dimension([a[0]-.55,0,a[2]-.3],[a[0]-.55,b[1],a[2]-.3],[a[0],0,a[2]],[a[0],b[1],a[2]],data.dimensions[1].toFixed(3),'H');$('#dim-length').textContent=data.dimensions[0].toFixed(3);$('#dim-width').textContent=data.dimensions[2].toFixed(3);$('#dim-height').textContent=data.dimensions[1].toFixed(3);}
function isCeiling(o){return o.d.layer==='ceiling'&&o.d.kind!=='light';}
function cutaway(o){return !walking&&mode==='interior'&&o.autoHidden===true;}
function updateVisibility(){invalidate(true);for(const o of objects){let show=!hidden.has(o.d.id)&&(!isolated||o.d.id===isolated);if(o.d.layer==='wall'&&!state.wall)show=false;if(o.d.layer==='floor'&&!state.floor)show=false;if(isCeiling(o)&&!state.ceiling)show=false;if(o.d.layer==='interior'&&!state.interior)show=false;if(cutaway(o)&&!isolated)show=false;if(isolated&&o.d.id===isolated)show=true;o.group.visible=walking?true:show;}
 $('#hidden-count').textContent=(mode==='interior'?'Interior view automatically hides camera-facing walls and attached finishes as you orbit. ':'')+hidden.size+' manually hidden item'+(hidden.size===1?'':'s')+'.'+(isolated?' One item isolated.':'');}
function setMode(value){if(walking)exitWalk();mode=value;for(const b of $$('[data-mode]')){b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));}if(value==='explode'){explodeTarget=1;state.ceiling=true;}else{explodeTarget=0;state.ceiling=value==='assembly';}state.wall=state.floor=state.interior=true;isolated=null;for(const k in state)$('#layer-'+k).checked=state[k];$('#explode').value=explodeTarget*100;$('#explode-value').textContent=explodeTarget*100+'%';$('#view-label').textContent=value==='explode'?'EXPLODED AXONOMETRIC':value==='assembly'?'ASSEMBLED AXONOMETRIC':'INTERIOR AXONOMETRIC';updateVisibility();frame();}
function setLight(o,on){invalidate();lightRefresh=0;o.lightOn=on;o.group.traverse(child=>{if(child.isMesh&&child.material.userData.baseEmission&&data.materials[child.userData.sourceMaterial]?.emission>0){child.material.emissiveIntensity=on?1.3:0;}});for(const l of o.lights){if(l.userData.originalIntensity===undefined)l.userData.originalIntensity=l.intensity;l.intensity=on?l.userData.originalIntensity:0;}}
function toggleObject(o){if(!o)return;invalidate(true);if(o.d.kind==='light')setLight(o,!o.lightOn);else if(['door','chair','ac'].includes(o.d.kind))o.target=o.target>.5?0:1;updateButtons();if(selected===o)renderInspector();}
function buttonState(id,on,text){const b=$('#'+id+'-toggle');b.setAttribute('aria-pressed',String(on));b.querySelector('.toggle').classList.toggle('on',on);$('#'+id+'-state').textContent=text;}
function updateButtons(){buttonState('door',doorObject?.target>.5,doorObject?.target>.5?'Open':'Closed');const lights=lightObjects.filter(o=>o.lightOn).length;buttonState('lights',lights>0,lights===12?'On':lights===0?'Off':lights+'/12');buttonState('ac',acObject?.target>.5,acObject?.target>.5?'On':'Off');const chairs=chairObjects.filter(o=>o.target>.5).length;buttonState('chairs',chairs>0,chairs===0?'In':chairs===36?'Out':chairs+'/36');}
function choose(o){invalidate();selected=o;$('#inspect-tab').click();$('.right-panel').classList.add('visible');selectionBox.visible=!!o;if(o)renderInspector();else{$('#inspector').innerHTML=emptyHTML;bindQuickSelect();$('.right-panel').classList.remove('visible');}renderList();}
const emptyHTML=$('#inspector').innerHTML;
function renderInspector(){if(!selected)return;const o=selected,d=o.d,matIds=[...new Set(d.meshes.map(m=>m.material))];const size=d.bounds[1].map((v,i)=>v-d.bounds[0][i]);const actions={door:['Close folding door','Open folding door'],chair:['Slide chair in','Slide chair out'],light:['Switch light off','Switch light on'],ac:['Switch AC off','Switch AC on']};const on=d.kind==='light'?o.lightOn:o.target>.5;
 $('#inspector').innerHTML=`<span class="inspector-tag">${esc(d.category)}</span><h2 class="item-title">${esc(d.kind==='door'?'Main entrance':d.name)}</h2><div class="item-family">${esc(d.family||d.name)}</div><div class="item-id">${d.kind==='ac'?'PROTOTYPE / ADDED CONCEPT':'REVIT ID / '+d.id}</div><div class="item-controls">${actions[d.kind]?`<button class="primary" id="operate-selected">${actions[d.kind][on?0:1]} <span>→</span></button>`:''}<button id="focus-selected">Focus</button><button id="isolate-selected">${isolated===d.id?'Show all':'Isolate'}</button><button id="hide-selected">Hide</button><button id="clear-selected">Clear</button></div><div class="inspector-section"><h3>OBJECT EXTENTS / METERS</h3><div class="item-dimensions"><div>${size[0].toFixed(3)}<small>X / Length</small></div><div>${size[2].toFixed(3)}<small>Y / Depth</small></div><div>${size[1].toFixed(3)}<small>Z / Height</small></div></div></div><div class="inspector-section"><h3>${d.kind==='ac'?'PROTOTYPE FINISH':'ORIGINAL MATERIALS'}</h3>${matIds.length?matIds.map(id=>{const m=data.materials[id];return `<div class="material-item"><span class="swatch" style="background-color:rgb(${m.color.join(',')});${m.maps?.color?.file?'background-image:url('+m.maps.color.file+')':''}"></span><span>${esc(m.name)}</span></div>`;}).join(''):'<div class="material-item"><span class="swatch" style="background:#f9f9ef"></span>Warm white concept finish</div>'}</div>${d.kind==='ac'?'<p class="item-family">Concept unit added for this prototype. Airflow is illustrative; no thermal calculation is performed.</p>':''}`;
 $('#operate-selected')?.addEventListener('click',()=>toggleObject(o));$('#focus-selected').onclick=()=>frame('iso',o);$('#isolate-selected').onclick=()=>{isolated=isolated===d.id?null:d.id;updateVisibility();if(isolated)frame('iso',o);else frame();renderInspector();};$('#hide-selected').onclick=()=>{hidden.add(d.id);updateVisibility();choose(null);toast('Object hidden. Reset or restore to bring it back.');};$('#clear-selected').onclick=()=>choose(null);
}
function renderList(){if(!data)return;const search=$('#object-search').value.toLowerCase(),cat=$('#object-category').value;const list=objects.filter(o=>(!cat||o.d.category===cat)&&[o.d.name,o.d.family,o.d.category,o.d.id].join(' ').toLowerCase().includes(search));$('#object-list').innerHTML=list.map(o=>`<button class="object-item ${selected===o?'selected':''}" data-id="${o.d.id}"><span class="obj-dot"></span>${esc(o.d.kind==='door'?'Main entrance':o.d.name)}<small>${esc(o.d.category)} / ${o.d.id}</small></button>`).join('')||'<p class="item-family">No matching objects.</p>';for(const b of $$('.object-item'))b.onclick=()=>{const o=objects.find(o=>String(o.d.id)===b.dataset.id);if(hidden.has(o.d.id))hidden.delete(o.d.id);choose(o);if(!o.group.visible){isolated=o.d.id;updateVisibility();renderInspector();}frame('iso',o);};}
function bindQuickSelect(){$('#select-door')?.addEventListener('click',()=>{choose(doorObject);frame('iso',doorObject);});$('#select-chair')?.addEventListener('click',()=>choose(chairObjects[0]));$('#select-ac')?.addEventListener('click',()=>{choose(acObject);frame('iso',acObject);});}
function visiblePick(mesh){for(let o=mesh;o;o=o.parent)if(!o.visible)return false;return true;}
function pick(event){const r=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);if(walking&&freeLook)pointer.set(0,0);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(pickMeshes,false).find(h=>visiblePick(h.object));}
let down=null;renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];if(walking&&e.pointerType==='touch'){lookTouch={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);}});renderer.domElement.addEventListener('pointerup',e=>{if(lookTouch?.id===e.pointerId)lookTouch=null;if(walking&&freeLook){const hit=pick(e);const o=hit&&objects.find(o=>o.d.id===hit.object.userData.id);if(o){toggleObject(o);toast(o.d.name);}return;}if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const hit=pick(e);choose(hit?objects.find(o=>o.d.id===hit.object.userData.id):null);});
let lastHover=0;renderer.domElement.addEventListener('pointermove',e=>{if(walking&&lookTouch?.id===e.pointerId){lookBy(e.clientX-lookTouch.x,e.clientY-lookTouch.y,.004);lookTouch.x=e.clientX;lookTouch.y=e.clientY;return;}if(walking&&freeLook)return;if(performance.now()-lastHover<70)return;lastHover=performance.now();if(e.buttons){$('#tooltip').style.display='none';return;}const hit=pick(e);if(hit){const o=objects.find(o=>o.d.id===hit.object.userData.id);const r=viewport.getBoundingClientRect();$('#tooltip').textContent=(o.d.kind==='door'?'Main entrance':o.d.name);$('#tooltip').style.cssText=`display:block;left:${Math.min(e.clientX-r.left+12,r.width-200)}px;top:${e.clientY-r.top+14}px`;renderer.domElement.style.cursor='pointer';}else{$('#tooltip').style.display='none';renderer.domElement.style.cursor='grab';}});renderer.domElement.addEventListener('pointerleave',()=>$('#tooltip').style.display='none');
function wireUI(){wireWalk();applyQuality(qualityName);document.addEventListener('click',()=>invalidate());for(const b of $$('[data-mode]'))b.onclick=()=>setMode(b.dataset.mode);$('#explode').oninput=e=>{if(walking)exitWalk();invalidate(true);explodeTarget=Number(e.target.value)/100;mode=explodeTarget>0?'explode':'assembly';state.ceiling=true;$('#layer-ceiling').checked=true;for(const b of $$('[data-mode]')){b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));}$('#explode-value').textContent=Math.round(explodeTarget*100)+'%';$('#view-label').textContent=explodeTarget>0?'EXPLODED AXONOMETRIC':'ASSEMBLED AXONOMETRIC';updateVisibility();};$('#explode').onchange=()=>frame();
 for(const k in state)$('#layer-'+k).onchange=e=>{state[k]=e.target.checked;updateVisibility();};
 $('#door-toggle').onclick=()=>toggleObject(doorObject);$('#ac-toggle').onclick=()=>toggleObject(acObject);$('#lights-toggle').onclick=()=>{const on=lightObjects.some(o=>!o.lightOn);for(const o of lightObjects)setLight(o,on);updateButtons();if(selected)renderInspector();};$('#chairs-toggle').onclick=()=>{const target=chairObjects.some(o=>o.target<.5)?1:0;for(const o of chairObjects)o.target=target;updateButtons();if(selected)renderInspector();};
 $('#dimensions').onclick=()=>{dimensionsOn=!dimensionsOn;$('#dimensions').classList.toggle('active',dimensionsOn);$('#dimensions').setAttribute('aria-pressed',String(dimensionsOn));};$('#ambience').onclick=()=>{evening=!evening;invalidate(true);ambient.intensity=evening?.16:.38;sun.intensity=evening?.12:3.15;fill.intensity=evening?.12:.22;renderer.toneMappingExposure=evening?1.5:1.12;scene.background.set(evening?0x747982:0xd5cfc3);viewport.style.background=evening?'radial-gradient(ellipse at 55% 35%,#747e87,#424b55)':'';$('#ambience').querySelector('span').textContent=evening?'Evening':'Daylight';$('#ambience').setAttribute('aria-pressed',String(evening));};
 $('#home-view').onclick=()=>frame();$('#top-view').onclick=()=>frame('top');$('#front-view').onclick=()=>frame('front');$('#zoom-in').onclick=()=>{camera.zoom=Math.min(12,camera.zoom*1.25);camera.updateProjectionMatrix();};$('#zoom-out').onclick=()=>{camera.zoom=Math.max(.35,camera.zoom/1.25);camera.updateProjectionMatrix();};
 $('#inspect-tab').onclick=()=>{$('#inspector').hidden=false;$('#object-browser').hidden=true;$('#inspect-tab').classList.add('active');$('#objects-tab').classList.remove('active');};$('#objects-tab').onclick=()=>{$('#inspector').hidden=true;$('#object-browser').hidden=false;$('#inspect-tab').classList.remove('active');$('#objects-tab').classList.add('active');renderList();};$('#object-search').oninput=renderList;$('#object-category').onchange=renderList;
 $('#restore-hidden').onclick=()=>{hidden.clear();isolated=null;updateVisibility();if(selected)renderInspector();toast('All manually hidden items restored.');};
 $('#reset').onclick=()=>{hidden.clear();isolated=null;doorObject.target=1;acObject.target=0;chairObjects.forEach(o=>o.target=0);lightObjects.forEach(o=>setLight(o,true));if(evening)$('#ambience').click();dimensionsOn=true;$('#dimensions').classList.add('active');$('#dimensions').setAttribute('aria-pressed','true');choose(null);setMode('interior');updateButtons();toast('Scene reset to its starting state.');};
 $('#show-explorer').onclick=()=>$('.right-panel').classList.toggle('visible');$('#hide-explorer').onclick=()=>$('.right-panel').classList.remove('visible');$('#help').onclick=()=>{releaseLook();keys.clear();$('#help-dialog').showModal();};$('#close-help').onclick=$('#start-exploring').onclick=()=>$('#help-dialog').close();
 $('#screenshot').onclick=saveView;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!walking){if(isolated){isolated=null;updateVisibility();frame();}choose(null);}});bindQuickSelect();}
function saveView(){architecturalRenderer.render(scene,camera);const out=document.createElement('canvas');out.width=renderer.domElement.width;out.height=renderer.domElement.height;const ctx=out.getContext('2d');ctx.fillStyle=evening?'#59636f':'#e4e6e8';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(renderer.domElement,0,0);const scale=out.width/host.clientWidth;ctx.scale(scale,scale);ctx.font='12px Arial';ctx.fillStyle='#3d5933';ctx.fillText('MATCHA / '+$('#view-label').textContent,22,28);for(const label of labels){if(label.el.style.display==='none')continue;const p=label.point.clone().project(camera);const x=(p.x*.5+.5)*host.clientWidth,y=(-p.y*.5+.5)*host.clientHeight;const text=label.el.textContent;ctx.fillStyle='#fcfff4';const width=ctx.measureText(text).width+12;ctx.fillRect(x-width/2,y-10,width,20);ctx.fillStyle='#526c41';ctx.fillText(text,x-width/2+6,y+4);}const a=document.createElement('a');a.download='Matcha-'+mode+'.png';a.href=out.toDataURL('image/png');a.click();toast('View saved as PNG.');}
function applyQuality(name){
 qualityName=name;quality=QUALITY[name];architecturalRenderer.configure(name);qualityChangedAt=performance.now();renderer.setPixelRatio(Math.min(devicePixelRatio,quality.dpr));
 sun.shadow.mapSize.set(quality.shadow,quality.shadow);sun.shadow.radius=quality.shadow/1024*2.2;if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
 for(const light of lightPool)scene.remove(light);lightPool.length=0;
 for(let i=0;i<quality.lights;i++){const light=new THREE.PointLight(0xffe5bd,0,5.5,2);scene.add(light);lightPool.push(light);}
 $('#quality-status').textContent=(name==='mobile'?'Mobile · 30 fps cap':name==='high'?'High detail':'Balanced')+($('#quality').value==='auto'?' · automatic':' · manual');
 lightRefresh=0;resize();invalidate(true);
}
function updateLightPool(){
 const candidates=lightObjects.filter(o=>o.lightOn&&o.group.visible);
 if(walking)candidates.sort((a,b)=>a.center.distanceToSquared(camera.position)-b.center.distanceToSquared(camera.position));
 // Fixed-size pool avoids recompiling shaders when fixtures are switched.
 for(let i=0;i<lightPool.length;i++){
  const source=walking?candidates[i]:candidates[Math.floor(i*candidates.length/Math.min(lightPool.length,candidates.length))];
  const light=lightPool[i];if(!source||i>=candidates.length){light.intensity=0;continue;}
  light.position.copy(source.lights[0].position).add(source.group.position);light.intensity=source.lights[0].intensity;
 }
}
function obstacles(){return objects.filter(o=>['Furniture','Casework'].includes(o.d.category)&&o.d.bounds[0][1]<1.8).map(o=>o.d.bounds.map(b=>[b[0]+o.group.position.x,b[1],b[2]+o.group.position.z]));}
function lookBy(dx,dy,sensitivity=.002){yaw-=dx*sensitivity;pitch=Math.max(-1.45,Math.min(1.45,pitch-dy*sensitivity));walkCamera.rotation.set(pitch,yaw,0,'YXZ');invalidate();}
function releaseLook(){freeLook=false;if(document.pointerLockElement===renderer.domElement)document.exitPointerLock();updateLookUI();}
function updateLookUI(){document.body.classList.toggle('free-look',walking&&freeLook);$('#freelook').setAttribute('aria-pressed',String(freeLook));$('#freelook').textContent=freeLook?'F · Release mouse':'F · Free look';}
async function toggleLook(){
 if(!walking)return;if(freeLook){releaseLook();return;}freeLook=true;updateLookUI();
 try{if(!renderer.domElement.requestPointerLock)throw Error('unavailable');await renderer.domElement.requestPointerLock();}
 catch{toast('Mouse capture unavailable here. Free look works while the pointer is over the model.');}
}
function enterWalk(){
 if(walking)return;
 savedWalkState={mode,explode,explodeTarget};walking=true;explode=explodeTarget=0;controls.enabled=false;camera=walkCamera;
 camera.position.set(...SPAWN);yaw=Math.PI/2;pitch=0;lookBy(0,0);keys.clear();touchKeys.clear();choose(null);
 for(const o of objects)o.initialized=false;
 document.body.classList.add('walking');$('#walk-toggle').textContent='Return to axonometric';$('#walk-toggle').setAttribute('aria-pressed','true');$('#walk-hud').hidden=false;
 $('#view-label').textContent='FIRST PERSON / EYE LEVEL';$('#tooltip').style.display='none';
 for(const el of $$('.layer-toggles input, #explode, #dimensions'))el.disabled=true;
 updateVisibility();resize();invalidate(true);toast(mobileDevice?'Hold the arrows to walk. Drag the view to look around.':'W A S D to walk · F to capture or release the mouse.');
}
function exitWalk(){
 if(!walking)return;releaseLook();walking=false;keys.clear();touchKeys.clear();lookTouch=null;camera=orbitCamera;controls.enabled=true;
 ({mode,explode,explodeTarget}=savedWalkState);for(const o of objects)o.initialized=false;
 document.body.classList.remove('walking');$('#walk-toggle').textContent='Walk inside';$('#walk-toggle').setAttribute('aria-pressed','false');$('#walk-hud').hidden=true;
 $('#view-label').textContent=mode==='explode'?'EXPLODED AXONOMETRIC':mode==='assembly'?'ASSEMBLED AXONOMETRIC':'INTERIOR AXONOMETRIC';
 for(const el of $$('.layer-toggles input, #explode, #dimensions'))el.disabled=false;
 updateCameraCutaway();updateVisibility();resize();invalidate(true);
}
function updateWalk(dt){
 const held=new Set([...keys,...touchKeys.values()]);const forward=Number(held.has('KeyW'))-Number(held.has('KeyS')),right=Number(held.has('KeyD'))-Number(held.has('KeyA'));
 if(!forward&&!right)return;
 const [dx,dz]=walkingVector(yaw,forward,right,dt);
 const all=obstacles();
 // If an animated chair moves into the viewer, permit walking out of its bounds.
 const solid=all.filter(b=>canStand(camera.position.x,camera.position.z,[b]));
 const [x,z]=moveOnPlan([camera.position.x,camera.position.z],dx,dz,solid);
 if(x!==camera.position.x||z!==camera.position.z){camera.position.x=x;camera.position.z=z;invalidate();}
}
function wireWalk(){
 $('#walk-toggle').onclick=()=>walking?exitWalk():enterWalk();$('#exit-walk').onclick=exitWalk;$('#freelook').onclick=toggleLook;
 $('#quality').onchange=e=>applyQuality(e.target.value==='auto'?(mobileDevice?'mobile':'balanced'):e.target.value);
 document.addEventListener('keydown',e=>{
  if(!walking||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,[contenteditable="true"]')||$('#help-dialog').open)return;
  if(['KeyW','KeyA','KeyS','KeyD'].includes(e.code)){e.preventDefault();keys.add(e.code);}
  if(e.code==='KeyF'&&!e.repeat){e.preventDefault();toggleLook();}
  if(e.code==='Escape'){releaseLook();keys.clear();}
 });
 document.addEventListener('keyup',e=>keys.delete(e.code));
 const clearMovement=()=>{keys.clear();touchKeys.clear();lookTouch=null;};
 window.addEventListener('blur',()=>{clearMovement();releaseLook();});document.addEventListener('visibilitychange',()=>{clearMovement();if(document.hidden)releaseLook();else invalidate();});
 document.addEventListener('pointerlockchange',()=>{freeLook=document.pointerLockElement===renderer.domElement;if(!freeLook)keys.clear();updateLookUI();});
 document.addEventListener('pointerlockerror',()=>{if(walking)toast('Move the mouse over the model to look; press F to release.');});
 document.addEventListener('mousemove',e=>{if(walking&&freeLook&&(document.pointerLockElement===renderer.domElement||e.target===renderer.domElement))lookBy(e.movementX,e.movementY);});
 renderer.domElement.addEventListener('pointercancel',()=>{lookTouch=null;down=null;});
 for(const button of $$('[data-walk-key]')){
  button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);touchKeys.set(e.pointerId,button.dataset.walkKey);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>touchKeys.delete(e.pointerId));
 }
}
function animate(now){requestAnimationFrame(animate);if(document.hidden){frameTime=now;return;}if(now-lastRender<1000/quality.fps-1)return;const dt=Math.min(.05,(now-frameTime)/1000);frameTime=now;const lerp=motionReduced?1:1-Math.exp(-7*dt);const exploding=Math.abs(explodeTarget-explode)>.00001;if(exploding)invalidate(true);explode+=(explodeTarget-explode)*lerp;if(Math.abs(explodeTarget-explode)<.0001)explode=explodeTarget;
 for(const o of objects){const moving=Math.abs(o.target-o.progress)>.00001;if(!moving&&!exploding&&o.initialized&&!(o.d.kind==='ac'&&o.target))continue;o.initialized=true;invalidate(moving||exploding);o.progress+=(o.target-o.progress)*lerp;if(Math.abs(o.target-o.progress)<.0001)o.progress=o.target;const d=o.d;let x=0,y=0,z=0;
  if(d.layer==='ceiling'){y=explode*(3.2+(o.center.y-3)*.4);}
  else if(d.layer==='floor'){y=-explode*(o.center.y<.13?1.4:.6);}
  else if(d.layer==='wall'){y=explode*.5;const wide=d.bounds[1][0]-d.bounds[0][0]>d.bounds[1][2]-d.bounds[0][2];if(wide)z=Math.sign(o.center.z)*explode*1.45;else x=Math.sign(o.center.x)*explode*1.45;}
  if(d.kind==='chair'){x+=o.slide.x*o.progress;z+=o.slide.z*o.progress;}
  o.group.position.set(x,y,z);if(o.contact)o.contact.visible=explode<.01;
  if(d.kind==='door'){const p=o.progress;o.openGroup.visible=p>.9999;o.closedGroup.visible=!o.openGroup.visible;for(const leaf of o.leaves){leaf.g.position.set(leaf.center[0]+(leaf.openCenter[0]-leaf.center[0])*p,leaf.center[1]+(leaf.openCenter[1]-leaf.center[1])*p,leaf.center[2]+(leaf.openCenter[2]-leaf.center[2])*p);leaf.g.rotation.y=leaf.angle*p;}}
  if(d.kind==='ac'){o.air.visible=o.progress>.05;o.led.material.color.set(o.progress>.5?0x78c6d1:0x899a80);o.air.children.forEach((c,i)=>{c.material.opacity=(.3+.15*Math.sin(now*.002+i))*o.progress;});}
 }
 ground.position.y=-.07-1.4*explode;if(!walking)controls.update();else updateWalk(dt);
 if(!dirty)return;
 if(now-lightRefresh>350||lightRefresh===0){updateLightPool();lightRefresh=now;}
 const frameInterval=now-lastRender;lastRender=now;dirty=false;
 renderer.shadowMap.needsUpdate=shadowDirty;shadowDirty=false;
 if(selected&&selected.group.visible){selectionBox.visible=true;selectionBox.box.setFromObject(selected.group);}else selectionBox.visible=false;
 dims.visible=dimensionsOn&&!walking;
 for(const label of labels){const point=label.point.clone();if(label.owner)point.add(label.owner.group.position);const p=point.project(camera);label.el.style.left=(p.x*.5+.5)*host.clientWidth+'px';label.el.style.top=(-p.y*.5+.5)*host.clientHeight+'px';label.el.style.display=(label.type==='dimension'?(!dimensionsOn||walking):(!label.owner.group.visible||(label.owner.target<.5&&selected!==label.owner)))||p.z>1||p.z<-1?'none':'';}
 const start=performance.now();architecturalRenderer.render(scene,camera);
 // Sustained render cost can reduce automatic quality; explicit choices stay fixed.
 if($('#quality').value==='auto'&&qualityName!=='mobile'&&now-qualityChangedAt>5000){slowFrames=(performance.now()-start>23||(frameInterval>28&&frameInterval<200))?slowFrames+1:Math.max(0,slowFrames-1);if(slowFrames>45){applyQuality(qualityName==='high'?'balanced':'mobile');slowFrames=0;}}
}
async function load(){try{
 const response=await fetch('./assets/model.json');if(!response.ok)throw Error('Model metadata could not be loaded.');data=await response.json();$('#load-progress').textContent='Unpacking 220 Revit elements and their materials…';
 const packed=await fetch('./assets/geometry.bin.gz');if(!packed.ok)throw Error('Geometry could not be loaded.');buffer=await new Response(packed.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 for(const d of data.elements)createElement(d);computeSlides();createAC();createContactShadows();createDimensions();
 const wallBindings=buildWallCutaway(data.elements);for(const o of objects){o.wallCutaway=wallBindings.get(o.d.id);o.autoHidden=false;}acObject.wallCutaway={hostId:10674076,normal:[0,0,-1]};updateCameraCutaway();
 const cats=[...new Set(objects.map(o=>o.d.category))].sort();for(const cat of cats){const option=document.createElement('option');option.value=option.textContent=cat;$('#object-category').append(option);}
 wireUI();updateVisibility();updateButtons();renderList();frame();$('#loader').classList.add('done');$('#loader').setAttribute('aria-hidden','true');requestAnimationFrame(animate);
 // Read-only diagnostics for model verification and QA.
 window.modelStudio={getSummary:()=>({elements:objects.length,sourceElements:data.counts.elements,materials:Object.keys(data.materials).length,chairs:chairObjects.length,lights:lightObjects.length,dimensions:data.dimensions,mode,walking,freeLook,quality:qualityName,pixelRatio:renderer.getPixelRatio(),activeLightBudget:lightPool.length,cameraPosition:camera.position.toArray(),acBounds:acObject.d.bounds,explode,door:doorObject.target,ac:acObject.target,lightsOn:lightObjects.filter(o=>o.lightOn).length,chairsOut:chairObjects.filter(o=>o.target>.5).length,selected:selected?.d.id,visible:objects.filter(o=>o.group.visible).length,triangles:architecturalRenderer.triangles,contactShading:architecturalRenderer.enabled,visualStyle:'warm architectural daylight'}),projectObject:id=>{const o=objects.find(o=>String(o.d.id)===String(id));if(!o)return null;const p=o.center.clone().add(o.group.position).project(camera);return {x:(p.x*.5+.5)*host.clientWidth,y:(-p.y*.5+.5)*host.clientHeight};}};
 }catch(error){console.error(error);$('#loader h2').textContent='The model could not be opened';$('#load-progress').textContent=error.message+' Refresh to try again.';$('.loading-line').hidden=true;}}
resize();load();
