// The exported café has an L-shaped plan. A 16 cm navigation radius fits its narrow aisle.
export const WALK_RADIUS=.16;
export const AC_BOUNDS=[[-3.5,2.6,-2.27],[-2.6,2.92,-2.04]];
export const SPAWN=[6.5,1.8,.1];
export function touchesBox(x,z,b,r=WALK_RADIUS){
 const dx=x-Math.max(b[0][0],Math.min(x,b[1][0]));
 const dz=z-Math.max(b[0][2],Math.min(z,b[1][2]));
 return dx*dx+dz*dz<r*r;
}
export function insidePlan(x,z,r=WALK_RADIUS){
 if(x<-7.283334+r||x>7.10-r||z<-2.27+r||z>2.27-r)return false;
 // Inner corner and timber lining of the corridor return.
 return !touchesBox(x,z,[[-20,0,-20],[-3.793666,4,1.24]],r);
}
export function canStand(x,z,obstacles=[]){
 return insidePlan(x,z)&&!obstacles.some(b=>touchesBox(x,z,b));
}
export function moveOnPlan(position,dx,dz,obstacles=[]){
 let [x,z]=position;const count=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.06));
 // Small swept steps prevent tunnelling, while separate axes let the viewer slide along walls.
 for(let i=0;i<count;i++){
  if(canStand(x+dx/count,z,obstacles))x+=dx/count;
  if(canStand(x,z+dz/count,obstacles))z+=dz/count;
 }
 return [x,z];
}
export function walkingVector(yaw,forward,right,dt,speed=1.35){
 const length=Math.max(1,Math.hypot(forward,right)),d=speed*Math.min(.05,dt)/length;
 return [(right*Math.cos(yaw)-forward*Math.sin(yaw))*d,(-right*Math.sin(yaw)-forward*Math.cos(yaw))*d];
}
export const QUALITY={high:{dpr:1.75,shadow:2048,lights:8,fps:60},balanced:{dpr:1.25,shadow:1024,lights:6,fps:60},mobile:{dpr:1,shadow:512,lights:4,fps:30}};
