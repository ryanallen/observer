import numpy as np, colorsys, sys
from PIL import Image
def bil(img,y,x):
    H,W=img.shape[:2]; y=np.clip(y,0,H-1.001); x=np.clip(x,0,W-1.001)
    y0=np.floor(y).astype(int); x0=np.floor(x).astype(int); fy=(y-y0)[...,None]; fx=(x-x0)[...,None]
    a=img[y0,x0]; b=img[y0,x0+1]; c=img[y0+1,x0]; d=img[y0+1,x0+1]
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy
S='C:/Users/rwall/AppData/Local/Temp/claude/bee04490368d73e8/8f20bb99-1fc6-4e22-84d7-e142243e602e/scratchpad/iris/'
src=np.asarray(Image.open('C:/Users/rwall/Desktop/Studio/work/observer/models/web/ruth_eye.webp').convert('RGB'),float)/255
SH,SW=src.shape[:2]; CX,CY,R=837.,527.,187.
W,H=1280,720; N=int(sys.argv[1]) if len(sys.argv)>1 else 90
sc=SH/H   # output pixel -> source pixel at zoom 1 (cover by height)
yy,xx=np.mgrid[0:H,0:W].astype(float)
ease=lambda t: t*t*(3-2*t)
def hsv2rgb(h,s,v):
    i=np.floor(h*6)%6; f=h*6-np.floor(h*6); p=v*(1-s); q=v*(1-f*s); t=v*(1-(1-f)*s)
    r=np.choose(i.astype(int),[v,q,p,p,t,v]); g=np.choose(i.astype(int),[t,v,v,q,p,p]); b=np.choose(i.astype(int),[p,p,t,v,v,q]); return np.stack([r,g,b],-1)
ZF=4.6
for n in range(N):
    t=n/(N-1); e=ease(t); z=np.exp(np.log(ZF)*e); tm=t*3.0
    # source coords, centred on the iris
    u=CX+(xx-W/2)*sc/z; v=CY+(yy-H/2)*sc/z
    dx=u-CX; dy=v-CY; r=np.hypot(dx,dy); a=np.arctan2(dy,dx)
    # melting: a swirl and a flowing warp that grow as we go in, strongest in the iris
    melt=e**1.3
    sw=melt*1.4*np.exp(-r/R)*np.sin(tm*1.7)+melt*0.9*np.exp(-r/(2*R))
    a2=a+sw
    r2=r*(1+melt*0.12*np.sin(r/R*9-tm*5+a*3))
    u2=CX+r2*np.cos(a2)+melt*R*0.06*np.sin(v/R*6+tm*4); v2=CY+r2*np.sin(a2)+melt*R*0.06*np.cos(u/R*5-tm*3.3)
    img=bil(src,v2,u2)
    lum=img.mean(-1)
    # the red light lifts as we go in: the skin and the white go toward neutral so the rainbow reads
    neu=np.clip(e*1.2,0,1)[...,None] if np.ndim(e) else min(1,e*1.2)
    g=lum[...,None]*np.array([1.0,.97,.95])
    img=img*(1-neu*.75)+g*neu*.75
    # rainbow: hue runs round the iris and out along its fibres, cycling in time
    hue=(a2/(2*np.pi)+np.log1p(r2/R)*1.3-tm*0.45)%1
    rb=hsv2rgb(hue,np.full_like(hue,.9),np.clip(lum*2.1+.12,0,1))
    ring=np.clip((r/R-0.33)/0.08,0,1)*np.clip((1.06-r/R)/0.08,0,1)   # the iris, not the pupil, not the white
    spread=np.clip((e-0.55)/0.45,0,1)                                    # late: it spills over everything
    k=np.clip(ring*np.clip(e*1.6,0,1)+spread*0.85*(r/R>0.33),0,1)[...,None]
    out=img*(1-k)+rb*k
    Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).save(S+f'f/{n:03d}.png')
# where the iris circle lands on screen at the end (for the page's hand-off)
print('end iris radius px', R*ZF/sc, 'centre', W/2, H/2)
