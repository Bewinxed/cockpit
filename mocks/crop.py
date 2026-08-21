import sys
from PIL import Image
# usage: crop.py in.png out.png x y w h [scale]  (CSS coords; image is 2x)
f,o,x,y,w,h=sys.argv[1],sys.argv[2],*map(int,sys.argv[3:7])
scale=float(sys.argv[7]) if len(sys.argv)>7 else 1.0
im=Image.open(f)
c=im.crop((x*2,y*2,(x+w)*2,(y+h)*2))
if scale!=1.0:
    c=c.resize((int(c.width*scale),int(c.height*scale)),Image.LANCZOS)
c.save(o)
print(o,c.size)
