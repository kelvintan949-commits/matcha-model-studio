import * as THREE from 'three';

const vertexShader=`varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const positionGLSL=`
uniform sampler2D tDepth;
uniform mat4 inverseProjection;
vec3 viewPosition(vec2 uv){
 float d=texture2D(tDepth,uv).x;
 vec4 p=inverseProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);
 return p.xyz/p.w;
}`;
export const aoFragment=`varying vec2 vUv;
${positionGLSL}
uniform vec2 texel;
uniform mat4 projection;
uniform float perspectiveCamera;
uniform float radius;
uniform int sampleCount;
void main(){
 float depth=texture2D(tDepth,vUv).x;
 if(depth>=.999999){gl_FragColor=vec4(1.0);return;}
 vec3 p=viewPosition(vUv);
 // Choose the closer derivative on each axis to avoid silhouette halos.
 vec3 left=p-viewPosition(vUv-vec2(texel.x,0.0));
 vec3 right=viewPosition(vUv+vec2(texel.x,0.0))-p;
 vec3 down=p-viewPosition(vUv-vec2(0.0,texel.y));
 vec3 up=viewPosition(vUv+vec2(0.0,texel.y))-p;
 vec3 dx=abs(left.z)<abs(right.z)?left:right;
 vec3 dy=abs(down.z)<abs(up.z)?down:up;
 vec3 n=normalize(cross(dx,dy)+vec3(0.0,0.0,.000000000001));
 float distanceScale=mix(1.0,max(.1,-p.z),perspectiveCamera);
 vec2 screenRadius=vec2(projection[0][0],projection[1][1])*.5*radius/distanceScale;
 float turn=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453)*6.283185;
 float occlusion=0.0;
 for(int i=0;i<24;i++){
  if(i>=sampleCount)break;
  float f=(float(i)+.5)/float(sampleCount);
  float angle=float(i)*2.399963+turn;
  vec2 uv=vUv+vec2(cos(angle),sin(angle))*screenRadius*sqrt(f);
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))continue;
  if(texture2D(tDepth,uv).x>=.999999)continue;
  vec3 delta=viewPosition(uv)-p;float d=length(delta);
  float horizon=max(0.0,dot(n,delta)-.012)/max(d,.001);
  occlusion+=horizon*(1.0-smoothstep(radius*.2,radius,d));
 }
 float ao=clamp(1.0-occlusion/float(sampleCount)*2.8,.36,1.0);
 gl_FragColor=vec4(vec3(ao),1.0);
}`;
export const finishFragment=`varying vec2 vUv;
${positionGLSL}
uniform sampler2D tColor;
uniform sampler2D tAO;
uniform vec2 aoTexel;
uniform float strength;
void main(){
 vec4 color=texture2D(tColor,vUv);
 float z=viewPosition(vUv).z,ao=0.0,weight=0.0;
 // Depth-aware filtering keeps contact shading on the correct side of edges.
 for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
  vec2 uv=vUv+vec2(float(x),float(y))*aoTexel;
  float w=exp(-abs(viewPosition(uv).z-z)*18.0)/(1.0+float(x*x+y*y));
  ao+=texture2D(tAO,uv).r*w;weight+=w;
 }
 ao=ao/max(weight,.0001);
 color.rgb*=mix(1.0,ao,strength);
 gl_FragColor=color;
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

// One geometry pass plus two inexpensive fullscreen passes. Mobile uses direct rendering.
export class ArchitecturalRenderer{
 constructor(renderer){
  this.renderer=renderer;this.enabled=false;this.supported=!!renderer.extensions?.has('EXT_color_buffer_float');
  this.size=new THREE.Vector2(1,1);this.scale=.5;this.triangles=0;
  if(!this.supported)return;
  this.color=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true,samples:2});
  this.color.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  this.ao=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
  this.screenScene=new THREE.Scene();this.screenCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const shared={tDepth:{value:this.color.depthTexture},inverseProjection:{value:new THREE.Matrix4()}};
  this.aoMaterial=new THREE.ShaderMaterial({vertexShader,fragmentShader:aoFragment,toneMapped:false,depthTest:false,depthWrite:false,uniforms:{...shared,texel:{value:new THREE.Vector2(1,1)},projection:{value:new THREE.Matrix4()},perspectiveCamera:{value:0},radius:{value:.6},sampleCount:{value:16}}});
  this.finishMaterial=new THREE.ShaderMaterial({vertexShader,fragmentShader:finishFragment,depthTest:false,depthWrite:false,uniforms:{...shared,tColor:{value:this.color.texture},tAO:{value:this.ao.texture},aoTexel:{value:new THREE.Vector2(1,1)},strength:{value:.85}}});
  this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.aoMaterial);this.quad.frustumCulled=false;this.screenScene.add(this.quad);
 }
 configure(quality){
  const enabled=this.supported&&quality!=='mobile';
  this.enabled=enabled;this.scale=quality==='high'?.65:.5;
  if(!this.supported)return;
  const samples=quality==='high'?4:2;if(this.color.samples!==samples){this.color.samples=samples;this.color.dispose();}
  this.aoMaterial.uniforms.sampleCount.value=quality==='high'?24:16;
  if(!enabled){this.color.setSize(1,1);this.ao.setSize(1,1);}else this.resize(this.size.x,this.size.y);
 }
 resize(width,height){
  this.size.set(width,height);if(!this.enabled)return;
  const w=Math.max(1,Math.round(width)),h=Math.max(1,Math.round(height));
  this.color.setSize(w,h);const aw=Math.max(1,Math.round(w*this.scale)),ah=Math.max(1,Math.round(h*this.scale));this.ao.setSize(aw,ah);
  this.aoMaterial.uniforms.texel.value.set(1/w,1/h);this.finishMaterial.uniforms.aoTexel.value.set(1/aw,1/ah);
 }
 render(scene,camera){
  const r=this.renderer;
  if(!this.enabled){r.render(scene,camera);this.triangles=r.info.render.triangles;return;}
  this.aoMaterial.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
  this.aoMaterial.uniforms.projection.value.copy(camera.projectionMatrix);
  this.aoMaterial.uniforms.perspectiveCamera.value=camera.isPerspectiveCamera?1:0;
  const target=r.getRenderTarget(),previousShaderError=r.debug?.onShaderError;
  try{
   r.setRenderTarget(this.color);r.render(scene,camera);this.triangles=r.info.render.triangles;
   if(r.debug)r.debug.onShaderError=(gl,program)=>{throw Error('Contact-shading shader: '+gl.getProgramInfoLog(program));};
   this.quad.material=this.aoMaterial;r.setRenderTarget(this.ao);r.render(this.screenScene,this.screenCamera);
   this.quad.material=this.finishMaterial;r.setRenderTarget(target);r.render(this.screenScene,this.screenCamera);
  }catch(error){
   this.enabled=this.supported=false;console.warn('Contact shading unavailable; using direct rendering.',error);
   if(r.debug)r.debug.onShaderError=previousShaderError;
   r.setRenderTarget(target);r.render(scene,camera);this.triangles=r.info.render.triangles;
  }finally{if(r.debug)r.debug.onShaderError=previousShaderError;r.setRenderTarget(target);}
 }
}

// Fine relief changes only surface response: original colors, maps, UVs and IDs are retained.
export function createSurfaceDetail(){
 const size=128,pixels=new Uint8Array(size*size*4);let seed=71291;
 for(let i=0;i<size*size;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=100+(seed>>>25);pixels.set([v,v,v,255],i*4);}
 const t=new THREE.DataTexture(pixels,size,size);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(5,5);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
}
export function finishProfile(source){
 const name=(source.name||'').toLowerCase();
 if(source.emission>0||source.metalness>.2)return {roughness:source.roughness,detail:0,wood:false};
 const wood=/wood|oak/.test(name),plaster=/plaster|cement|concrete|grout/.test(name),paint=/fantasy|wpc|hijau/.test(name);
 return {roughness:wood?Math.max(.4,source.roughness):plaster?Math.max(.8,source.roughness):source.roughness,detail:plaster?.00035:paint?.00018:0,wood};
}
