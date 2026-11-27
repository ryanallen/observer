"""Observer procedural GLBs. Blender Z-up; glTF export is Y-up.
Run: blender -b -P models/src/build_assets.py -- boat|box|buoy|seabed
"""
import bpy, math, os, random, sys, struct, zlib
from mathutils import Vector
random.seed(17)
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..'))
NAME=sys.argv[-1] if sys.argv[-1] in ('boat','box','buoy','seabed') else 'boat'
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

def mat(n,c,m=0,r=.6,e=None):
 a=bpy.data.materials.new(n);a.diffuse_color=(*c,1);a.use_nodes=True;p=a.node_tree.nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=m;p.inputs['Roughness'].default_value=r
 if e:p.inputs['Emission Color'].default_value=(*e,1);p.inputs['Emission Strength'].default_value=3
 return a
white=mat('hull warm white',(.69,.73,.72),.15,.5);red=mat('antifouling red',(.13,.024,.018),.1,.86)
roof=mat('weathered offwhite wheelhouse roof',(.48,.51,.55),.08,.78)
roof_edge=mat('worn pale wheelhouse roof edge',(.58,.57,.52),.12,.75,(.20,.19,.16))
roof_edge.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.28
radar_white=mat('radar white enamel',(.90,.91,.88),.02,.55,(.25,.27,.26))
radar_white.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.55
antenna_metal=mat('pale antenna steel',(.52,.54,.53),.3,.57)
gunwale_steel=mat('pale worn gunwale steel',(.62,.63,.58),.45,.52,(.32,.30,.25))
gunwale_steel.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.22
bulwark_inside=mat('worn pale inner bow bulwark',(.47,.46,.42),.08,.82,(.14,.13,.11))
bulwark_inside.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.20
navy=mat('survey hull midnight blue',(.018,.053,.082),.27,.51)
navy_hull=mat('survey hull weathered vertex paint',(.018,.053,.082),.27,.56)
vc=navy_hull.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='PaintVariation'
navy_hull.node_tree.links.new(vc.outputs['Color'],navy_hull.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
stripe=mat('dark boot top',(.019,.035,.042),.3,.55);deck=mat('non slip aft deck',(.021,.023,.024),0,.30)
steel=mat('galvanized steel',(.38,.44,.43),.75,.46);dark=mat('black rubber iron',(.018,.025,.028),.3,.77)
cooler_enamel=mat('worn white cooler enamel',(.91,.90,.87),.05,.53)
drum_steel=mat('pale grey cable drum steel',(.54,.56,.58),.60,.40)
cable_steel=mat('oxidized orange brown wound cable',(.28,.15,.075),.38,.65)
orange=mat('safety orange',(.85,.16,.023),.25,.48);glass=mat('window_lit',(.40,.27,.14),.1,.20,(1,.57,.25))
aframe_orange=mat('chipped bright orange A frame',(.91,.45,.17),.25,.65)
buoyred=mat('channel buoy red',(.48,.025,.018),.22,.59)
lamp=mat('warm worklamp',(.95,.73,.32),.05,.23,(1,.69,.28))
bulb_halo=mat('warm bulb halo',(.92,.36,.09),0,.30,(1,.40,.10))
bulb_halo.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=1.8
bulb_core=mat('warm bulb bright core',(1,.72,.32),0,.22,(1,.64,.25))
bulb_core.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=6
navr=mat('nav_red',(.9,.015,.01),.1,.2,(1,.015,.006));navg=mat('nav_green',(.02,.9,.12),.1,.2,(.02,1,.09));navw=mat('mast_white',(.95,.9,.75),.1,.2,(1,.9,.7))
bronze=mat('yellow tarnished bronze',(.36,.27,.09),.83,.68);patina=mat('verdigris',(.065,.23,.17),.4,.9)
silt=mat('silt crust',(.17,.19,.16),.1,.93);rust=mat('rusted iron',(.31,.087,.026),.5,.88);bottle=mat('cloudy bottle green',(.10,.23,.16),.1,.39)
crate=mat('worn dark equipment case',(.075,.085,.075),.28,.82)

def mesh(n,v,f,m):
 d=bpy.data.meshes.new(n);d.from_pydata(v,[],f);d.update();o=bpy.data.objects.new(n,d);bpy.context.collection.objects.link(o);d.materials.append(m)
 for p in d.polygons:p.use_smooth=True
 return o
def cube(n,loc,dim,m,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=n;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bevel:b=o.modifiers.new('fabricated corners','BEVEL');b.width=bevel;b.segments=2;o.modifiers.new('weighted normal','WEIGHTED_NORMAL')
 return o
def cyl(n,loc,r,d,m,seg=16,rot=None):
 bpy.ops.mesh.primitive_cylinder_add(vertices=seg,radius=r,depth=d,location=loc);o=bpy.context.object;o.name=n;o.data.materials.append(m)
 if rot:o.rotation_euler=rot
 return o
def ball(n,loc,sc,m,seg=12):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=8,location=loc);o=bpy.context.object;o.name=n;o.scale=sc;o.data.materials.append(m);return o
def rod(n,a,b,r,m,seg=10):
 a=Vector(a);b=Vector(b);d=b-a;o=cyl(n,(a+b)*.5,r,d.length,m,seg);o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o
def square_beam(n,a,b,width,depth,m):
 a=Vector(a);b=Vector(b);d=b-a;o=cube(n,(a+b)*.5,(width,depth,d.length),m,.012)
 o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o
def ring(n,loc,r,t,m,rot=None,seg=20,minor=6):
 bpy.ops.mesh.primitive_torus_add(major_segments=seg,minor_segments=minor,location=loc,major_radius=r,minor_radius=t)
 o=bpy.context.object;o.name=n;o.data.materials.append(m)
 if rot:o.rotation_euler=rot
 return o

def boat_paint_texture(material,kind,base,seed):
 """Bake compact weathered paint into a JPEG the glTF exporter can embed."""
 size={'white':224,'roof':192,'hull':320,'orange':192,'aframe':192,'red':192,'steel':192}[kind];rng=random.Random(seed)
 grids=[]
 for n in (12,48,192):grids.append((n,[rng.random() for _ in range(n*n)]))
 def noise(u,v,grid):
  n,g=grid;x=u*n;y=v*n;ix=int(x)%n;iy=int(y)%n;fx=x-int(x);fy=y-int(y)
  fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
  a=g[iy*n+ix];b=g[iy*n+(ix+1)%n];c=g[((iy+1)%n)*n+ix];d=g[((iy+1)%n)*n+(ix+1)%n]
  return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy
 drips=[(rng.random(),rng.uniform(.65,.87) if kind=='white' else rng.uniform(.57,.82),rng.uniform(.27,.56) if kind=='white' else rng.uniform(.12,.38),rng.uniform(.010,.022) if kind=='white' else rng.uniform(.003,.011)) for _ in range(18 if kind=='hull' else 28 if kind=='white' else 10)]
 if kind=='hull':drips += [((y+7)/14,.72,.27,.013) for y in (-5.1,-2.3,.65,3.7)]
 pixels=[];orm=[]
 rough={'hull':.83,'white':.85,'roof':.84,'deck':.16,'orange':.79,'aframe':.72,'steel':.63,'red':.88}[kind]
 metal={'hull':.24,'white':.06,'roof':.08,'deck':.21,'orange':.22,'aframe':.25,'steel':.58,'red':.12}[kind]
 for j in range(size):
  v=j/(size-1)
  for i in range(size):
   u=i/(size-1);a=noise(u,v,grids[0]);b=noise(u,v,grids[1]);c=noise(u,v,grids[2]);grain=(a-.5)*.26+(b-.5)*.19+(c-.5)*.08
   rust=0.0;patch_rust=0.0
   if kind in ('hull','white','roof','orange','aframe','red'):
    for x,top,length,width in drips:
     du=min(abs(u-x),1-abs(u-x))
     if top-length<v<top:
      edge=(v-(top-length))/length
      rust=max(rust,max(0.0,1-du/width)*min(1.0,edge*6)*(.35+.65*b))
   wear=max(0.0,c-.66)*2.0
   if kind=='hull':
    rust=max(rust, max(0.0,.30-v)*2.2*(.4+b))
    # Scupper and fitting runoff starts at the gunwale and reaches the side.
    for sx,top,length,width in ((.085,.625,.25,.009),(.16,.64,.22,.007),(.27,.63,.28,.011),(.375,.635,.21,.008),(.51,.64,.27,.010),(.625,.65,.20,.009),(.695,.69,.27,.007),(.78,.72,.23,.011),(.845,.76,.26,.008)):
     if top-length<v<top:
      progress=(top-v)/length
      centre=sx+.005*math.sin(v*54+sx*33)
      taper=max(.27,1-progress*.68)
      run=max(0,1-abs(u-centre)/(width*taper))*(.65+.5*b)
      rust=max(rust,run*1.5)
    # Broad, broken corrosion at the stern quarter and along the aft waterline.
    # The coarse field makes a large readable shape; finer noise breaks its edge.
    for cx,cy,wu,wv in ((.025,.31,.10,.105),(.105,.35,.145,.10),(.225,.38,.12,.075),(.31,.49,.10,.075),(.44,.435,.07,.05)):
     edge=(b-.5)*.050+(c-.5)*.013
     patch=math.exp(-((u-cx)/wu)**2-((v-cy+edge)/wv)**2)
     patch_rust=max(patch_rust,patch*(.7+.8*max(0,b-.35)))
    line=math.exp(-((v-(.415+.012*math.sin(u*31)+(b-.5)*.018))/.04)**2)
    patch_rust=max(patch_rust,line*max(0,1-u/.55)*(.35+.8*b))
    patch_rust=min(1.0,patch_rust)
    worn=(.30,.34,.37);oxide=(.36,.14,.055);rust*=.57
    scrape=math.exp(-((v-.38)/.035)**2)*max(0,b-.43)*(2.7 if u<.55 else 1.5)
    wear=max(wear,min(.9,scrape))
    for cx,cy,wu,wv in ((.12,.46,.04,.025),(.34,.50,.055,.027),(.59,.47,.045,.023),(.78,.52,.045,.028)):
     bare=math.exp(-((u-cx)/wu)**2-((v-cy)/wv)**2)*max(0,(b-.32)*1.6)
     wear=max(wear,min(.9,bare))
   elif kind=='white':
    worn=(.61,.60,.56);oxide=(.34,.17,.075);rust*=1.4
    corner=max(0,.085-min(u,1-u,v,1-v))/.085
    rust=max(rust,corner*(.26+.28*b),max(0,b-.54)*.44)
    lower=max(0,(.54-v)/.54)
    edge=max(0,(.14-min(u,1-u))/.14)
    grime=min(.82,lower*(.18+.27*a+.22*b)+edge*(.07+.16*b)+max(0,b-.57)*.12)
   elif kind=='roof':
    worn=(.22,.25,.29);oxide=(.25,.12,.055);rust*=.75
    grain+=(a-.5)*.30+(b-.5)*.18
    wear=max(wear,max(0,b-.38)*1.1)
   elif kind=='deck':
    worn=(.21,.22,.21);oxide=(.23,.15,.09);rust=max(0.0,b-.68)*.28
    path=max(0,1-abs(u-.42)/.12)*(.30+.4*a)
    wear=max(wear,path*.42)
   elif kind in ('orange','aframe'):
    worn=(.57,.47,.27);oxide=(.29,.12,.05)
    wear=max(wear,max(0,c-.62)*1.8)
   elif kind=='red':
    worn=(.065,.105,.14);oxide=(.19,.05,.03);rust*=.24
    for cx,wu in ((.04,.10),(.19,.055),(.37,.07),(.49,.045)):
     chip=math.exp(-((u-cx)/wu)**2-((v-.35)/.038)**2)*max(0.0,(b-.22)*2.1)
     wear=max(wear,min(1.0,chip*1.5))
    stern_wear=max(0,1-u/.42)*math.exp(-((v-(.37+(b-.5)*.04))/.09)**2)
    wear=max(wear,min(1,stern_wear*(.65+.7*b)))
   else:worn=(.42,.46,.44);oxide=(.25,.14,.085);rust=max(0.0,b-.74)*.3
   if kind=='white':grain+=(a-.5)*.10+max(0,b-.54)*-.12
   if kind=='hull':grain+=(a-.5)*.13
   color=[base[k]*(1+grain)+wear*(worn[k]-base[k])*.75 for k in range(3)]
   if kind=='white':
    dirt=(.26,.29,.29)
    color=[color[k]*(1-grime)+dirt[k]*grime for k in range(3)]
   color=[max(.002,min(1,color[k]*(1-rust*.86)+oxide[k]*rust*.86)) for k in range(3)]
   if kind=='hull':
    bright_oxide=(.58,.225,.075)
    color=[color[k]*(1-patch_rust*.95)+bright_oxide[k]*patch_rust*.95 for k in range(3)]
   if kind=='deck':color=[max(.003,c0*(.80+.20*a)) for c0 in color]
   pixels.extend((*color,1.0))
   rr=max(.15,min(.96,rough+(a-.5)*.11+(b-.5)*.08-(.12 if kind=='deck' else 0)*max(0,b-.55)))
   mm=max(0,min(1,metal*(1-rust*.5)))
   orm.extend((max(.65,1-rust*.17),rr,mm,1))
 image=bpy.data.images.new('boat '+kind+' baked color',width=size,height=size,alpha=True)
 image.pixels.foreach_set(pixels)
 path=os.path.join(ROOT,'src',f'boat_{kind}_color_{size}.jpg')
 image.filepath_raw=path;image.file_format='JPEG';bpy.context.scene.render.image_settings.quality=78;image.save()
 bpy.data.images.remove(image)
 image=bpy.data.images.load(path);image.pack()
 p=material.node_tree.nodes.get('Principled BSDF')
 tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
 material.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
 material.diffuse_color=(*base,1)
 image=bpy.data.images.new('boat '+kind+' baked ORM',width=size,height=size,alpha=True)
 image.pixels.foreach_set(orm)
 path=os.path.join(ROOT,'src',f'boat_{kind}_ORM_{size}.jpg')
 image.filepath_raw=path;image.file_format='JPEG';bpy.context.scene.render.image_settings.quality=78;image.save()
 bpy.data.images.remove(image)
 image=bpy.data.images.load(path);image.colorspace_settings.name='Non-Color';image.pack()
 tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
 split=material.node_tree.nodes.new('ShaderNodeSeparateColor');split.mode='RGB'
 material.node_tree.links.new(tex.outputs['Color'],split.inputs['Color'])
 material.node_tree.links.new(split.outputs['Green'],p.inputs['Roughness'])
 material.node_tree.links.new(split.outputs['Blue'],p.inputs['Metallic'])
 group=bpy.data.node_groups.get('glTF Settings')
 if not group:
  group=bpy.data.node_groups.new('glTF Settings','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
 settings=material.node_tree.nodes.new('ShaderNodeGroup');settings.node_tree=group
 material.node_tree.links.new(split.outputs['Red'],settings.inputs['Occlusion'])

def boat_normal_texture(materials):
 size=256;pixels=[]
 for j in range(size):
  v=j/(size-1)
  for i in range(size):
   u=i/(size-1)
   dx=.15*math.cos(u*113)*math.sin(v*97)+.09*math.cos(u*349+v*21)
   dy=.15*math.sin(u*113)*math.cos(v*97)+.07*math.sin(v*313-u*17)
   z=1/math.sqrt(1+dx*dx+dy*dy)
   pixels.extend(((1-dx*z)*.5,(1-dy*z)*.5,z*.5+.5,1))
 image=bpy.data.images.new('boat baked surface normal',width=size,height=size,alpha=True)
 image.pixels.foreach_set(pixels)
 path=os.path.join(ROOT,'src','boat_surface_normal_256.jpg')
 image.filepath_raw=path;image.file_format='JPEG';bpy.context.scene.render.image_settings.quality=74;image.save()
 bpy.data.images.remove(image)
 image=bpy.data.images.load(path);image.colorspace_settings.name='Non-Color';image.pack()
 for material in materials:
  p=material.node_tree.nodes.get('Principled BSDF')
  tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
  normal=material.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.8
  material.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color'])
  material.node_tree.links.new(normal.outputs['Normal'],p.inputs['Normal'])

def boat_planar_uv(obj):
 if obj.type!='MESH' or obj.data.uv_layers:return
 layer=obj.data.uv_layers.new(name='Paint UV')
 for face in obj.data.polygons:
  for index in face.loop_indices:
   co=obj.data.vertices[obj.data.loops[index].vertex_index].co
   if obj.name=='working deck':uv=((co.x+2.2)/4.4,(co.y+7)/14)
   elif obj.data.materials and obj.data.materials[0]==white:
    if abs(face.normal.z)>.55:uv=(co.x/max(.001,obj.dimensions.x)+.5,co.y/max(.001,obj.dimensions.y)+.5)
    elif abs(face.normal.x)>abs(face.normal.y):uv=(co.y/max(.001,obj.dimensions.y)+.5,co.z/max(.001,obj.dimensions.z)+.5)
    else:uv=(co.x/max(.001,obj.dimensions.x)+.5,co.z/max(.001,obj.dimensions.z)+.5)
   else:uv=((co.y+7)/14,(co.z+1.1)/3.2)
   layer.data[index].uv=uv

def boat_window_texture():
 # Four distinct interior panes sampled from the approved scene image.
 path=os.path.join(ROOT,'src','boat_window_color_256.jpg')
 source=bpy.data.images.load(path)
 raw=list(source.pixels);pixels=[]
 for i in range(0,len(raw),4):
  pixel=i//4;u=(pixel%128)/127;v=((pixel//256)%128)/127;tile=(pixel%256)//128+2*((pixel//256)//128)
  light=max(0.0,min(1.0,(raw[i+1]-.08)/.43))
  shade=.34+.66*light**1.55
  # Console silhouettes and a chair break up the photographic amber interior.
  desk=.62 if v<(.17+.025*math.sin(u*12+tile)) else 0.0
  band=.87 if tile in (1,2,3) and .24<v<(.35+.012*math.sin(u*13)) else 0.0
  upright=.56 if abs(u-(.24+.13*(tile%2)))<.035 and .20<v<.76 else 0.0
  chair=.95 if tile==3 and abs(u-.57)<.13 and .38<v<.71 else 0.0
  shoulders=.92 if tile==3 and abs(u-.57)<.23 and .31<v<.48 else 0.0
  chair_head=.97 if tile==3 and ((u-.57)/.12)**2+((v-.74)/.10)**2<1 else 0.0
  diagonal=.52 if tile in (1,2) and abs(v-(.24+.58*u))<.043 and .2<u<.82 else 0.0
  shade*=1-max(desk,band,upright,chair,shoulders,chair_head,diagonal)
  lamp=tile==2 and ((u-.75)/.08)**2+((v-.66)/.075)**2<1
  if lamp:pixels.extend((1.0,.75,.31,1))
  else:pixels.extend((raw[i]*shade,raw[i+1]*shade,raw[i+2]*shade,1))
 image=bpy.data.images.new('boat window interior with deep shadows',width=256,height=256,alpha=True)
 image.pixels.foreach_set(pixels)
 image.scale(224,224)
 path=os.path.join(ROOT,'src','boat_window_detail_224.jpg')
 image.filepath_raw=path;image.file_format='JPEG';bpy.context.scene.render.image_settings.quality=74;image.save()
 bpy.data.images.remove(image)
 image=bpy.data.images.load(path);image.pack()
 p=glass.node_tree.nodes.get('Principled BSDF')
 tex=glass.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
 glass.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
 glass.node_tree.links.new(tex.outputs['Color'],p.inputs['Emission Color'])
 p.inputs['Emission Strength'].default_value=1.3

def window_uv(obj,tile=0):
 """Give each pane a distinct lit interior from the four-pane atlas."""
 layer=obj.data.uv_layers.active
 if layer is None:layer=obj.data.uv_layers.new(name='cabin interior UV')
 for loop in obj.data.loops:
  co=obj.data.vertices[loop.vertex_index].co
  if obj.dimensions.x<obj.dimensions.y:
   u=co.y/max(.001,obj.dimensions.y)+.5
  else:u=co.x/max(.001,obj.dimensions.x)+.5
  v=co.z/max(.001,obj.dimensions.z)+.5
  layer.data[loop.index].uv=((u+(tile%2))*.5,(v+(tile//2))*.5)

def boat():
 white.name='weathered offwhite superstructure';navy_hull.name='survey hull textured blue paint'
 for material,kind,base,seed in ((white,'white',(.73,.74,.71),11),(roof,'roof',(.48,.51,.55),19),(navy,'hull',(.09,.185,.31),12),(navy_hull,'hull',(.09,.185,.31),12),(red,'red',(.17,.045,.026),16),(orange,'orange',(.75,.245,.048),14),(aframe_orange,'aframe',(.91,.45,.17),23),(steel,'steel',(.31,.33,.31),15)):
  boat_paint_texture(material,kind,base,seed)
 aframe_cross=aframe_orange.copy();aframe_cross.name='warm chipped orange A frame crossbeam'
 cross_shader=aframe_cross.node_tree.nodes.get('Principled BSDF')
 cross_shader.inputs['Emission Color'].default_value=(.40,.12,.025,1)
 cross_shader.inputs['Emission Strength'].default_value=.55
 boat_normal_texture((white,roof,navy,navy_hull,orange,aframe_orange,steel))
 boat_window_texture()
 # +Y in Blender becomes -Z in the GLB, toward the bow.
 coarse=[(-7,.68,.82,.84),(-6.4,1.36,1.53,.91),(-4.8,1.70,1.94,.99),(-2,1.80,2.04,1.06),(1,1.67,1.91,1.14),(3.6,1.40,1.67,1.29),(5.5,.90,1.12,1.53),(6.7,.19,.27,1.76),(6.95,.016,.025,1.86)]
 def cat(a,b,c,d,t):return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
 stations=[]
 for i in range(len(coarse)-1):
  for step in range(4):
   t=step/4;stations.append(tuple(cat(coarse[max(0,i-1)][k],coarse[i][k],coarse[i+1][k],coarse[min(len(coarse)-1,i+2)][k],t) for k in range(4)))
 stations.append(coarse[-1])
 bands=[(-1.1,.72),(-.55,.82),(-.13,1),(-.045,1.02),(.10,1.045),('mid',1.085),('sheer',1)]
 for side in (-1,1):
  for k,m in enumerate((red,red,red,red,navy_hull,navy_hull)):
   v=[]
   for y,ch,w,h in stations:
    for j in (k,k+1):
     z,f=bands[j];v.append((side*w*f,y,h if z=='sheer' else h*.57 if z=='mid' else z))
   faces=[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(stations)-1)]
   if side==1:faces=[tuple(reversed(f)) for f in faces]
   o=mesh('hull band',v,faces,m)
   if m==navy_hull:boat_planar_uv(o)
   so=o.modifiers.new('steel plate','SOLIDIFY');so.thickness=.04
 v=[(-w*.72,y,-1.1) for y,ch,w,h in stations]+[(w*.72,y,-1.1) for y,ch,w,h in reversed(stations)]
 mesh('bottom plating',v,[tuple(range(len(v)))],red)
 v=[(-w,y,h) for y,ch,w,h in stations]+[(w,y,h) for y,ch,w,h in reversed(stations)]
 mesh('working deck',v,[tuple(range(len(v)-1,-1,-1))],deck)
 transom=mesh('closed steel transom',[(-.59,-7,-1.1),(.59,-7,-1.1),(.82,-7,.84),(-.82,-7,.84)],[(0,1,2,3)],navy)
 boat_planar_uv(transom)
 for loop in transom.data.loops:
  co=transom.data.vertices[loop.vertex_index].co
  transom.data.uv_layers.active.data[loop.index].uv=((co.x+.82)/1.64*.22,(co.z+1.1)/3.2)
 # Continuous rubbing strake follows the curved sheer, with forward bulwarks.
 for side in (-1,1):
  for a,b in zip(stations[:-1],stations[1:]):
   y0,ch0,w0,h0=a;y1,ch1,w1,h1=b
   rod('pale rubbing strake',(side*w0,y0,h0-.10),(side*w1,y1,h1-.10),.052,gunwale_steel,8)
  forward=[s for s in stations if s[0]>=1.0]
  def bow_rise(y):return max(0.0,min(1.0,(y-2.5)/4.1))
  def bow_edge(s):
   y,ch,w,h=s;r=bow_rise(y)
   return (side*w*(1.10+.08*r),y,h+.44+.30*r)
  for a,b in zip(forward[:-1],forward[1:]):
   y0,ch0,w0,h0=a;y1,ch1,w1,h1=b
   mesh('forward bulwark',[(side*w0,y0,h0),(side*w1,y1,h1),bow_edge(b),bow_edge(a)],[(0,1,2,3)] if side==1 else [(3,2,1,0)],navy)
   inner=lambda point:(point[0]-side*.035,point[1],point[2])
   inside=[inner((side*w0,y0,h0)),inner((side*w1,y1,h1)),inner(bow_edge(b)),inner(bow_edge(a))]
   mesh('pale inner bow bulwark',inside,[(3,2,1,0)] if side==1 else [(0,1,2,3)],bulwark_inside)
  for a,b in zip(forward[:-1],forward[1:]):
   rod('raised bow gunwale',bow_edge(a),bow_edge(b),.040,gunwale_steel,8)
  rail_stations=[min(forward,key=lambda s:abs(s[0]-y)) for y in (3.0,4.0,5.0,5.9,6.6,6.95)]
  rail_points=[]
  for s in rail_stations:
   x,y,z=bow_edge(s);top=(x,y,z+.25)
   rod('bow guardrail upright',(x,y,z),top,.032,steel,8)
   rail_points.append(top)
  for a,b in zip(rail_points[:-1],rail_points[1:]):rod('bow guardrail',a,b,.032,antenna_metal,8)
  for y in (1.8,2.8,3.8,4.8):
   s=min(stations,key=lambda q:abs(q[0]-y));sy,ch,w,h=s
   cube('bulwark scupper',(side*(w*1.004),sy,h+.09),(.017,.24,.085),dark,.01)
 # Wheelhouse, raked forward glazing, and close-fitting roof.
 cube('forward wheelhouse',(0,2.82,1.79),(2.65,3.70,1.45),white,.07)
 cube('wheelhouse roof',(0,2.82,3.02),(2.71,3.76,.18),roof,.03)
 for x in (-1.34,1.34):
  cube('pale wheelhouse side fascia',(x,2.82,3.04),(.055,3.78,.15),roof_edge,.01)
  cube('raised roof side lip',(x,2.82,3.17),(.065,3.78,.12),roof_edge,.012)
 for y in (.94,4.70):
  cube('pale wheelhouse end fascia',(0,y,3.04),(2.72,.055,.15),roof_edge,.01)
  cube('raised roof end lip',(0,y,3.17),(2.72,.065,.12),roof_edge,.012)
 for i,x in enumerate((-.83,0,.83)):
  w=cube('raked windscreen',(x,4.705,2.47),(.72,.035,.66),glass,.014)
  window_uv(w,(i+1)%4);w.rotation_euler[0]=math.radians(12)
 for side in (-1,1):
  frame=cube('forward corner window frame',(side*1.24,4.52,2.47),(.62,.052,.78),dark,.012)
  frame.rotation_euler=(math.radians(12),0,side*math.radians(42))
  o=cube('wrapped raked corner window',(side*1.24,4.485,2.53),(.54,.044,.58),glass,.01)
  window_uv(o,3 if side<0 else 1);o.rotation_euler=(math.radians(12),0,side*math.radians(42))
 side_window_y=(1.94,2.62,3.30,3.98)
 for x in (-1.33,1.33):
  for i,y in enumerate(side_window_y):
   w=cube('side window',(x,y,2.605),(.038,.53,.58),glass,.006);window_uv(w,i)
   for edge in (-.285,.285):cube('black side window mullion',(x*1.018,y+edge,2.605),(.023,.078,.67),dark,.004)
   for edge in (-.315,.315):cube('window horizontal frame',(x*1.018,y,2.605+edge),(.023,.61,.052),dark,.004)
 for side in (-1,1):
  x=side*1.36;y=1.27
  cube('aft side door dark frame',(x,y,1.96),(.045,.62,1.30),dark,.012)
  cube('aft side door worn panel',(side*1.39,y,1.96),(.034,.53,1.22),white,.010)
  cube('aft side door window frame',(side*1.414,y,2.29),(.025,.39,.40),dark,.006)
  door_side_glass=cube('aft side door lit window',(side*1.438,y,2.29),(.025,.33,.34),glass,.005)
  window_uv(door_side_glass,2)
 ball('cabin aft corner lamp housing',(-1.43,1.03,2.87),(.095,.075,.095),dark,10)
 ball('cabin aft corner warm bulb',(-1.48,1.03,2.87),(.060,.047,.060),bulb_halo,12)
 ball('cabin aft corner bright core',(-1.51,1.03,2.87),(.019,.016,.019),bulb_core,10)
 for i,x in enumerate((-.91,.91)):
  w=cube('aft corner window',(x,.949,2.49),(.49,.038,.78),glass,.006);window_uv(w,i+1)
  for edge in (-.255,.255):cube('aft window mullion',(x+edge,.925,2.49),(.019,.018,.82),dark,.003)
  for edge in (-.40,.40):cube('aft window horizontal frame',(x,.925,2.49+edge),(.53,.018,.02),dark,.003)
 stain=mat('deep brown cabin rust runoff',(.31,.13,.055),.02,.93)
 rust_edge=mat('faded cabin rust feather',(.53,.32,.20),.0,.96)
 for side in (-1,1):
  rng=random.Random(286+(side+1)*13)
  anchors=[]
  for k,window_y in enumerate(side_window_y):
   for n in range((3,5,2,4)[k]):
    y=window_y+rng.uniform(-.28,.28)
    top=2.26+rng.uniform(-.035,.09)
    bottom=rng.uniform(1.06,1.92)
    width=rng.uniform(.011,.032) if n else rng.uniform(.038,.068)
    anchors.append((y,top,bottom,width))
  anchors.append((window_y+.32,2.54,rng.uniform(1.19,1.75),rng.uniform(.014,.030)))
  for layer,material,spread in (('faded',rust_edge,1.7),('dark',stain,1.0)):
   verts=[];faces=[]
   for i,(y,top,bottom,width) in enumerate(anchors):
    start=len(verts);bend=rng.uniform(.006,.023);phase=rng.uniform(0,6.28)
    for j in range(6):
     t=j/5;z=top+(bottom-top)*t
     shift=bend*math.sin(phase+t*7.0)+.008*t*math.sin(i*3.4)
     taper=max(.04,(1-t)**(.42+.25*(i%3)))
     w=width*spread*taper*(.72+.28*math.sin(phase+t*9.0)**2)
     x=side*(1.346 if layer=='dark' else 1.344)
     verts.extend(((x,y+shift-w,z),(x,y+shift+w*.7,z)))
    faces.extend([(start+2*j,start+2*j+1,start+2*j+3,start+2*j+2) if side<0 else (start+2*j+2,start+2*j+3,start+2*j+1,start+2*j) for j in range(5)])
   mesh(layer+' irregular cabin rust runs',verts,faces,material)
 cube('aft cabin door',(0,.93,1.94),(.75,.07,1.3),white,.025)
 cube('aft cabin door dark frame',(0,.879,1.94),(.83,.035,1.38),dark,.014)
 cube('aft cabin door worn panel',(0,.851,1.94),(.73,.032,1.27),white,.012)
 cube('aft door lit window frame',(0,.826,2.26),(.47,.028,.43),dark,.008)
 door_window=cube('aft door lit window',(0,.806,2.26),(.40,.028,.36),glass,.006)
 window_uv(door_window,2)
 ball('door handle',(.26,.813,1.82),(.035,.02,.03),steel,10)
 # Small warm roof lamp, roof safety rails, and ladder.
 cube('roof searchlight plinth',(-.98,1.21,3.23),(.29,.31,.18),steel,.018)
 cyl('pale roof searchlight barrel',(-.98,1.20,3.43),.17,.70,white,20,(math.pi/2,0,0))
 cyl('searchlight dark rim',(-.98,.84,3.43),.165,.035,dark,20,(math.pi/2,0,0))
 cyl('roof lamp warm face',(-.98,.815,3.43),.135,.018,bulb_halo,20,(math.pi/2,0,0))
 ball('roof lamp bright core',(-.98,.796,3.43),(.052,.014,.052),bulb_core,12)
 for x in (-1.37,1.37):
  for y in (1.13,2.72,4.35):rod('roof rail upright',(x,y,3.10),(x,y,3.51),.021,steel,8)
  rod('roof handrail',(x,1.13,3.51),(x,4.35,3.51),.024,steel,8)
 for x in (-1.62,1.62):
  for y in (-5.8,-4.5,-3.2,-1.9,-.6,.7):rod('rail stanchion',(x,y,1.06),(x,y,1.83),.026,steel,8)
  for z,r in ((1.83,.03),(1.48,.018)):rod('side rail',(x,-5.8,z),(x,.7,z),r,steel,8)
  cube('deck locker',(x*.91,-1.46,1.28),(.42,1.18,.35),steel,.035)
  for y in (-5.55,5):
   cyl('bollard',(x*.72,y,1.23),.10,.28,steel,12);rod('bollard crossbar',(x*.72-.18,y,1.36),(x*.72+.18,y,1.36),.045,steel)
  for y in (-4.7,-2.5,.1):ring('tyre fender',(x*1.03,y,.54),.34,.105,dark,(0,math.pi/2,0))
 # Round, open stern gantry: the legs lean aft and inward to the sheave beam.
 for side in (-1,1):
  x=side*.71
  rod('chipped round orange A frame leg',(side*1.06,-6.87,1.0),(x,-7.74,4.26),.087,aframe_orange,14)
  rod('hydraulic ram barrel',(x*1.25,-5.25,1.15),(x,-7.27,2.77),.072,dark,16)
  rod('chromed hydraulic piston',(x,-7.27,2.77),(x,-7.39,3.04),.045,steel,14)
  ball('ram hinge',(x*1.25,-5.25,1.15),(.13,.13,.13),steel,12)
  ball('ram hinge',(x,-7.39,3.04),(.10,.10,.10),steel,12)
 rod('round orange A frame crossbar',(-.78,-7.74,4.26),(.78,-7.74,4.26),.083,aframe_cross,14)
 for x in (-.71,.71):ball('orange gantry tube joint',(x,-7.74,4.26),(.105,.105,.105),aframe_orange,12)
 rod('sheave hanger',(0,-7.74,4.26),(0,-7.74,4.05),.06,steel)
 cyl('sheave cheeks',(0,-7.74,3.96),.23,.27,steel,24,(0,math.pi/2,0))
 cyl('sheave wheel',(0,-7.74,3.96),.16,.30,dark,24,(0,math.pi/2,0))
 anchor=bpy.data.objects.new('sheave',None);bpy.context.collection.objects.link(anchor);anchor.location=(0,-7.78,3.76)
 for x in (-.47,.47):
  ball('flood_lamp',(x,-7.79,4.15),(.065,.036,.05),lamp,10)
  cube('floodlamp housing',(x,-7.70,4.15),(.17,.12,.12),dark,.012)
 for x in (-.48,.48):cyl('winch flange',(x,-3.3,1.55),.49,.065,drum_steel,20,(0,math.pi/2,0))
 cube('white cooler box',(-.98,-3.08,1.33),(.90,.50,.45),cooler_enamel,.035)
 cube('cooler lid shadow line',(-.98,-3.08,1.565),(.93,.53,.022),dark,.008)
 cube('cooler raised white lid',(-.98,-3.08,1.595),(.97,.56,.05),cooler_enamel,.022)
 cyl('winch drum',(0,-3.3,1.55),.37,.91,drum_steel,20,(0,math.pi/2,0))
 for i in range(10):ring('wound steel cable',(-.36+i*.08,-3.3,1.55),.39,.019,cable_steel,(0,math.pi/2,0),12,4)
 cyl('winch dark spindle',(-.53,-3.3,1.55),.15,.025,dark,16,(0,math.pi/2,0))
 cube('hydraulic winch motor',(.68,-3.3,1.4),(.49,.53,.45),steel,.04)
 cube('sample table',(0,-5.52,1.20),(1.20,.48,.10),steel,.025)
 # Compact hydraulic crane, hose reel, line coils and strapped equipment crates.
 cyl('crane swivel pedestal',(1.13,-4.57,1.36),.22,.48,steel,20)
 rod('crane upright',(1.13,-4.57,1.56),(1.13,-4.57,2.78),.105,orange,16)
 rod('crane knuckle',(1.13,-4.57,2.78),(.63,-5.47,3.20),.085,orange,14)
 rod('crane lifting tip',(.63,-5.47,3.20),(.50,-5.93,3.15),.063,orange,12)
 rod('crane ram',(1.15,-4.60,1.86),(.82,-5.08,2.97),.039,steel,12)
 rod('crane hook cable',(.50,-5.93,3.15),(.50,-5.93,2.64),.009,dark,8)
 ball('crane hook',(.50,-5.93,2.61),(.065,.06,.075),steel,12)
 for x,y in ((-.90,-2.23),(-.85,-5.15)):
  for i in range(3):ring('coiled deck line',(x,y,1.10+i*.020),.20-i*.03,.013,steel,seg=24)
 for x,y in ((-.94,-3.8),(.80,-1.90)):
  cube('worn equipment case',(x,y,1.32),(.46,.55,.37),crate,.018)
  for j in (-.17,.17):rod('equipment case strap',(x+j,y-.26,1.48),(x+j,y+.26,1.48),.012,dark,8)
 for x in (-.38,.38):cyl('hose reel flange',(x,-2.13,1.50),.44,.055,drum_steel,20,(0,math.pi/2,0))
 cyl('hose reel core',(0,-2.13,1.50),.32,.72,drum_steel,18,(0,math.pi/2,0))
 for i in range(8):ring('hose winding',(-.29+i*.083,-2.13,1.50),.345,.019,cable_steel,(0,math.pi/2,0),12,4)
 cyl('hose reel dark spindle',(-.43,-2.13,1.50),.13,.025,dark,16,(0,math.pi/2,0))
 cube('rail side white work box',(-1.12,-5.18,1.34),(.86,.48,.42),cooler_enamel,.023)
 cube('rail box lid shadow',(-1.12,-5.18,1.558),(.88,.50,.016),dark,.005)
 cube('rail box white lid',(-1.12,-5.18,1.587),(.91,.53,.05),cooler_enamel,.018)
 # Small nonskid weld beads and raised plate fasteners, visible in grazing light.
 for y in [(-5.8+i*.30) for i in range(20)]:
  h=min(stations,key=lambda q:abs(q[0]-y))[3]
  for x in (-1.2,-.65,.65,1.2):cube('deck tread',(x,y,h+.014),(.055,.10,.012),steel,.004)
 for side in (-1,1):
  for y,ch,w,h in stations[:-1]:
   for z in (.30,.73):
    ball('hull plate fastener',(side*w*1.072,y,z),(.013,.013,.013),steel,8)
 ring('life ring',(-1.49,1.66,1.77),.28,.08,orange,(0,math.pi/2,0))
 cyl('radar dome',(0,3.12,4.08),.055,1.82,antenna_metal,12)
 cube('radar mast platform',(0,3.12,5.02),(.48,.42,.07),antenna_metal,.015)
 rod('radar short crossbar',(-.37,3.12,4.91),(.37,3.12,4.91),.022,antenna_metal,8)
 ball('radar cover',(0,3.12,5.34),(.27,.27,.29),radar_white)
 for x,y,height in ((-.92,1.28,5.76),(-1.17,2.14,5.96)):
  rod('radio whip',(x,y,3.18),(x-.06,y,height),.021,antenna_metal,8)
  cyl('radio whip base',(x,y,3.18),.055,.13,antenna_metal,10)
 ball('mast_white',(0,3.12,5.66),(.042,.042,.042),navw)
 ball('nav_red',(-1.48,4.46,3.07),(.025,.025,.025),navr)
 ball('nav_green',(1.48,4.46,3.07),(.025,.025,.025),navg)
 for x in (-1.15,1.15):ball('aft work light',(x,.69,2.91),(.055,.032,.04),lamp,10)
 for x in (-.78,.78):
  cube('deck work lamp housing',(x,-6.48,2.37),(.16,.13,.11),dark,.012)
  ball('deck_work_lamp',(x,-6.56,2.35),(.125,.020,.112),bulb_halo,12)
  ball('deck work bright core',(x,-6.588,2.35),(.027,.014,.027),bulb_core,12)

 # Scattered corrosion lies just above the aft steel rather than following a
 # texture row around the hull. The uneven silhouettes leave navy paint between patches.
 stern_oxide_dark=mat('stern dark brown corrosion',(.15,.045,.021),.14,.94,(.19,.045,.020))
 stern_oxide_dark.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.32
 stern_oxide_high=mat('upper transom dark oxide',(.11,.034,.018),.10,.96,(.14,.04,.02))
 stern_oxide_high.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.25
 def hull_skin(y,z,side):
  for a,b in zip(stations[:-1],stations[1:]):
   if a[0]<=y<=b[0]:
    t=(y-a[0])/(b[0]-a[0]);w=a[2]*(1-t)+b[2]*t;h=a[3]*(1-t)+b[3]*t;break
  else:
   w,h=(stations[0][2],stations[0][3]) if y<stations[0][0] else (stations[-1][2],stations[-1][3])
  middle=h*.57
  if z<=-.045:f=1.0
  elif z<=.10:f=1.02+(z+.045)/.145*.025
  elif z<=middle:f=1.045+(z-.10)/max(.01,middle-.10)*.040
  else:f=1.085-(z-middle)/max(.01,h-middle)*.085
  return side*(w*f+.023)
 corrosion=[(-6.70,.18,.42,.19),(-6.25,.33,.35,.16),(-5.78,.10,.42,.14),
            (-5.25,.25,.40,.16),(-4.70,.04,.35,.11),(-4.17,.18,.30,.13),(-3.73,.07,.25,.09)]
 corrosion += [(-6.78,.47,.40,.24),(-6.42,.43,.44,.24),(-6.08,.49,.35,.21)]
 for side in (-1,1):
  for indices,paint in ((range(7),stern_oxide_dark),(range(7,len(corrosion)),stern_oxide_high)):
   vertices=[];faces=[]
   for index in indices:
    cy,cz,ry,rz=corrosion[index]
    cz+=.10
    rng=random.Random(710+index*37)
    points=[]
    count=7 if paint==stern_oxide_dark else 11
    for k in range(count):
     angle=k*2*math.pi/count
     radius=(.72+.26*math.sin(angle*3+index)+rng.uniform(-.18,.18)) if count==7 else (.72+.30*math.sin(angle*3+index)+rng.uniform(-.24,.22))
     y=max(-6.98,min(-3.35,cy+math.cos(angle)*ry*radius))
     z=max(-.065,min(.78,cz+math.sin(angle)*rz*radius))
     points.append((hull_skin(y,z,side),y,z))
    centre=len(vertices);vertices.append((hull_skin(cy,cz,side),cy,cz))
    vertices.extend(points)
    faces.extend((centre,centre+1+k,centre+1+(k+1)%count) for k in range(count))
   mesh('broken stern corrosion',vertices,faces,paint)
 # The transom carries the same corrosion around its lower corners.
 for paint,blots in ((stern_oxide_dark,[(-.53,.18,.27,.20),(.10,.30,.30,.22),(.55,.13,.18,.18)]),
                    (stern_oxide_high,[(-.52,.53,.40,.29),(-.08,.54,.45,.30),(.48,.52,.35,.28)])):
  vertices=[];faces=[]
  for index,(cx,cz,rx,rz) in enumerate(blots):
   rng=random.Random(903+index*29+int(cx*100));centre=len(vertices);vertices.append((cx,-7.028,cz))
   count=7 if paint==stern_oxide_dark else 11
   for k in range(count):
    angle=k*2*math.pi/count
    radius=.76+rng.uniform(-.20,.18) if count==7 else .76+.27*math.sin(angle*3+index)+rng.uniform(-.24,.20)
    vertices.append((max(-.78,min(.78,cx+math.cos(angle)*rx*radius)),-7.028,
                     max(-.08,min(.79,cz+math.sin(angle)*rz*radius))))
   faces.extend((centre,centre+1+k,centre+1+(k+1)%count) for k in range(count))
  mesh('broken transom corrosion',vertices,faces,paint)
 for side in (-1,1):
  for cy,ry in ((-6.63,.16),(-5.08,.18)):
   vertices=[]
   for y,z in ((cy-ry,.015),(cy+ry,.025),(cy+ry*.72,.042),(cy-ry*.60,.035)):
    vertices.append((hull_skin(y,z,side)+side*.007,y,z))
   mesh('worn grey waterline chip',vertices,[(0,1,2,3)],gunwale_steel)
 for x0,x1 in ((-.69,-.43),(-.22,.07),(.34,.62)):
  rod('worn grey transom boot top',(x0,-7.04,.025),(x1,-7.04,.025),.008,gunwale_steel,8)
 for x0,x1,z in ((-.66,-.54,.48),(-.17,-.03,.62),(.43,.58,.40)):
  rod('pale scrape on corroded transom',(x0,-7.045,z),(x1,-7.045,z+.012),.005,gunwale_steel,6)

def box():
 def shell(n,lo,hi,z0,z1,m):
  v=[(x,y,z0) for x,y in lo]+[(x,y,z1) for x,y in hi]
  o=mesh(n,v,[(3,2,1,0)]+[(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)]+[(4,5,6,7)],m)
  b=o.modifiers.new('rounded eroded edges','BEVEL');b.width=.007;b.segments=2;o.modifiers.new('weighted normals','WEIGHTED_NORMAL')
 base=[(-.22,-.18),(.19,-.185),(.215,.16),(-.20,.18)]
 middle=[(-.219,-.188),(.21,-.18),(.22,.17),(-.21,.182)]
 lid=[(-.225,-.19),(.218,-.184),(.227,.18),(-.205,.19)]
 top=[(-.198,-.17),(.20,-.175),(.215,.158),(-.2,.173)]
 shell('asymmetric bronze casket',base,middle,0,.17,bronze)
 shell('sealed raised lid',lid,top,.165,.225,bronze)
 for i in range(4):
  a=lid[i];b=lid[(i+1)%4];rod('lid border',(a[0],a[1],.204),(b[0],b[1],.204),.006,patina,7)
 for n,(cx,cy,s) in enumerate([(-.09,.03,.095),(.06,-.06,.076),(.075,.095,.051)]):
  ball('monster body',(cx,cy,.228),(s*.42,s*.75,.012),bronze)
  ball('distorted head',(cx+s*.18,cy+s*.7,.236),(s*.40,s*.32,.014),bronze)
  for j in range(5):
   y=cy-s*.5+j*s*.21;rod('relief ribs',(cx-s*.35,y,.235),(cx+s*.37,y+s*.10,.236),.0035,bronze,6)
  for j in (-1,1):
   rod('twisted relief limb',(cx+j*s*.27,cy,.237),(cx+j*s*.8,cy-s*.6,.229),.006,bronze,6)
   ball('eye socket',(cx+s*.18+j*s*.13,cy+s*.77,.245),(.005,.005,.003),dark,8)
 for i in range(55):
  x=random.uniform(-.19,.19);y=random.uniform(-.16,.16);r=random.uniform(.003,.011)
  ball('verdigris and silt crust',(x,y,.228),(r,r*.75,r*.20),patina if i%4 else silt,8)
 for side in (-1,1):
  for i in range(12):
   ball('side corrosion',(side*.211,random.uniform(-.15,.15),random.uniform(.035,.15)),(.004,.013,.009),patina,8)
 for i in range(5):
  x=-.17+i*.083;rod('strange lock cuts',(x,-.188,.06),(x+.027,-.188,.12),.004,patina,6)

def box_v2():
 # Five unequal corners; each upper vertex shifts differently so every wall leans.
 lo=[(-.224,-.143),(.124,-.182),(.226,-.093),(.183,.144),(-.170,.166)]
 hi=[(-.207,-.163),(.145,-.155),(.219,-.078),(.160,.159),(-.193,.143)]
 rim=[(-.238,-.175),(.155,-.190),(.247,-.100),(.206,.174),(-.208,.184)]
 tarnish=mat('dark tarnished bronze brown #5e4a24',(.112,.068,.018),.85,.67)
 worn=mat('worn bright bronze high edges',(.41,.29,.094),.85,.63)
 verd=mat('verdigris in recesses #4e8a74',(.075,.21,.15),0,.90)
 mud=mat('silt grey lower crust',(.17,.17,.15),.03,.94)
 pits=mat('black oxidized pits',(.028,.032,.025),.2,.87)
 def pent(n,a,b,z0,z1,ma):
  v=[(x,y,z0) for x,y in a]+[(x,y,z1) for x,y in b]
  f=[tuple(range(4,-1,-1))]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)]+[tuple(range(5,10))]
  o=mesh(n,v,f,ma);q=o.modifiers.new('worn cast edge','BEVEL');q.width=.004;q.segments=2;o.modifiers.new('cast bronze normals','WEIGHTED_NORMAL')
 pent('five sided leaning bronze shell',lo,hi,0,.174,tarnish)
 # The lower third is a separate uneven mud crust rather than a bright outline.
 lowmud=[(x*.997,y*.998) for x,y in lo]
 topmud=[(x*.985+random.uniform(-.006,.006),y*.99+random.uniform(-.005,.005)) for x,y in hi]
 pent('adhered silt below tide line',lowmud,topmud,.003,.055,mud)
 pent('lopsided overhanging lid skirt',rim,[(x*.98,y*.98) for x,y in rim],.171,.215,tarnish)
 # Sample a sculpted height field: mottled cells, tangled bodies and serpentine
 # ribbon borders. The 512px derivatives become the embedded tangent normal map.
 seeds=[(random.uniform(-1,1),random.uniform(-1,1)) for _ in range(47)]
 def relief(x,y):
  # x,y are the planar UV domain mapped to [-1,1].
  near=min((x-sx)**2+(y-sy)**2 for sx,sy in seeds)
  cellular=math.exp(-near*65)
  noise=.5*math.sin(31*x+3*math.sin(19*y))*math.sin(27*y+4*math.cos(13*x))
  ridge=0
  for cx,cy,s in ((-.44,.25,.33),(.30,-.29,.29),(.31,.35,.24)):
   dx=(x-cx)/s;dy=(y-cy)/s
   torso=math.exp(-((math.sqrt(dx*dx*.7+dy*dy*1.5)-.78)/.13)**2)
   head=math.exp(-(((dx-.35)**2+(dy-.75)**2)/.12))
   coils=math.exp(-((dy-.38*math.sin(5*dx+cy*4))/.095)**2)*math.exp(-(dx/1.1)**4)
   horns=math.exp(-((dy-(1.12-.8*abs(dx-.3)))/.09)**2)*math.exp(-((dx-.3)/.65)**4)
   ridge+=.55*torso+.55*head+.28*coils+.22*horns
  border=math.exp(-((min(1-abs(x),1-abs(y))-.11)/.035)**2)
  twist=math.sin(34*x+11*math.sin(7*y))*math.sin(28*y+8*math.sin(5*x))
  # Broad forms remain in the geometry; tight interlaced cuts are baked below.
  return .006*ridge+.002*border+.0007*cellular+.0008*noise+.0003*twist
 # Colour and ORM at 512 px: verdigris settles in valleys, worn bronze only
 # catches raised relief. R=occlusion, G=roughness, B=metallic.
 N=512;heights=[0.0]*(N*N)
 for j in range(N):
  y=2*j/(N-1)-1
  for i in range(N):heights[j*N+i]=relief(2*i/(N-1)-1,y)
 rgba=[];orm=[]
 for j in range(N):
  for i in range(N):
   h=heights[j*N+i];z=.5*(math.sin(i*.051+j*.077)+math.sin(i*.019-j*.033))
   cavity=max(0,min(.88,(.0020-h)*140+.06*z))
   wear=max(0,min(.75,(h-.003)*90))
   base=(.30,.22,.10);green=(.19,.34,.28);high=(.48,.35,.17)
   color=[base[k]*(1-cavity)+green[k]*cavity for k in range(3)]
   color=[color[k]*(1-wear)+high[k]*wear for k in range(3)]
   rgba.extend((*color,1))
   orm.extend((1-cavity*.50,.65+cavity*.25,.85*(1-cavity),1))
 def texture(n,pixels,space,dim):
  path=os.path.join(ROOT,'src',n.replace(' ','_')+'.png')
  raw=bytearray()
  for row in range(dim):
   raw.append(0)
   for col in range(dim):
    start=4*(row*dim+col)
    raw.extend(max(0,min(255,round(255*pixels[start+k]))) for k in range(4))
  def chunk(tag,data):return struct.pack('!I',len(data))+tag+data+struct.pack('!I',zlib.crc32(tag+data)&0xffffffff)
  png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',dim,dim,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(raw),6))+chunk(b'IEND',b'')
  with open(path,'wb') as fh:fh.write(png)
  im=bpy.data.images.load(path);im.name=n;im.colorspace_settings.name=space
  if 'color' in n or 'normal' in n:
   _=im.pixels[0]
   bpy.context.scene.render.image_settings.quality=95
   jpg=path[:-4]+'.jpg';im.filepath_raw=jpg;im.file_format='JPEG';im.save()
   bpy.data.images.remove(im);im=bpy.data.images.load(jpg);im.name=n;im.colorspace_settings.name=space
   os.remove(path)
  im.pack();return im
 def baked_normal(dim,sample):
  field=[sample(i/(dim-1),j/(dim-1)) for j in range(dim) for i in range(dim)]
  out=[]
  for j in range(dim):
   for i in range(dim):
    il=max(0,i-1);ir=min(dim-1,i+1);jb=max(0,j-1);jt=min(dim-1,j+1)
    dx=(field[j*dim+ir]-field[j*dim+il])*dim*.72
    dy=(field[jt*dim+i]-field[jb*dim+i])*dim*.72
    nx,ny,nz=-dx,-dy,1;length=math.sqrt(nx*nx+ny*ny+nz*nz)
    out.extend(((nx/length+1)*.5,(ny/length+1)*.5,(nz/length+1)*.5,1))
  return out
 def top_sample(u,v):
  # Smoothly interpolate the sculpt and add 1024px interlaced tool marks.
  x=u*(N-1);y=v*(N-1);ix=min(N-2,int(x));iy=min(N-2,int(y));fx=x-ix;fy=y-iy
  h=(heights[iy*N+ix]*(1-fx)+heights[iy*N+ix+1]*fx)*(1-fy)+(heights[(iy+1)*N+ix]*(1-fx)+heights[(iy+1)*N+ix+1]*fx)*fy
  xx=2*u-1;yy=2*v-1
  braid=.00032*math.sin(132*xx+12*math.sin(17*yy))*math.sin(116*yy+9*math.sin(13*xx))
  cut=.00026*math.sin(189*xx+47*yy)*math.cos(157*yy-23*xx)
  return h*.55+braid+cut
 def side_sample(u,v):
  x=2*u-1;y=2*v-1
  braid=.0020*math.sin(17*x+4*math.sin(10*y))*math.sin(12*y+5*math.sin(9*x))
  tendril=.0035*math.exp(-((y-.38*math.sin(7*x))/.16)**2)+.0025*math.exp(-((y+.45*math.sin(6*x+1))/.13)**2)
  head=.0025*math.exp(-((x-.20)**2+(y-.15)**2)/.08)
  return braid+tendril+head+.0004*math.sin(95*x+47*y)
 albedo=texture('casket_dark_bronze_color_512',rgba,'sRGB',512)
 ormimg=texture('casket_ORM_512',orm,'Non-Color',512)
 nmap=texture('casket_crisp_relief_normal_1024',baked_normal(1024,top_sample),'Non-Color',1024)
 sidenormal=texture('casket_five_side_panels_normal_512',baked_normal(512,side_sample),'Non-Color',512)
 side_color=[];side_orm=[]
 for j in range(512):
  for i in range(512):
   h=side_sample(i/511,j/511)
   cavity=max(0,min(.82,(.0015-h)*125))
   wear=max(0,min(.62,(h-.002)*95))
   base=(.369,.29,.141);green=(.306,.54,.455);high=(.59,.44,.20)
   c=[base[k]*(1-cavity)+green[k]*cavity for k in range(3)]
   side_color.extend((*(c[k]*(1-wear)+high[k]*wear for k in range(3)),1))
   side_orm.extend((1-cavity*.45,.67+cavity*.23,.85*(1-cavity),1))
 sidealbedo=texture('casket_five_side_panels_color_512',side_color,'sRGB',512)
 sideorm=texture('casket_five_side_panels_ORM_512',side_orm,'Non-Color',512)
 sculpt=mat('matte dark antique lid with baked relief',(.112,.068,.018),.85,.67)
 nt=sculpt.node_tree;pr=nt.nodes.get('Principled BSDF')
 tex=nt.nodes.new('ShaderNodeTexImage');tex.image=albedo;tex.label='512px dark bronze and cavity patina'
 nt.links.new(tex.outputs['Color'],pr.inputs['Base Color'])
 texn=nt.nodes.new('ShaderNodeTexImage');texn.image=nmap;texn.label='1024px crisp sculpted tangent normal'
 nm=nt.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.68
 nt.links.new(texn.outputs['Color'],nm.inputs['Color']);nt.links.new(nm.outputs['Normal'],pr.inputs['Normal'])
 texorm=nt.nodes.new('ShaderNodeTexImage');texorm.image=ormimg;texorm.label='512px occlusion roughness metallic'
 split=nt.nodes.new('ShaderNodeSeparateColor');split.mode='RGB'
 nt.links.new(texorm.outputs['Color'],split.inputs['Color'])
 nt.links.new(split.outputs['Green'],pr.inputs['Roughness']);nt.links.new(split.outputs['Blue'],pr.inputs['Metallic'])
 group=bpy.data.node_groups.new('glTF Settings','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
 settings=nt.nodes.new('ShaderNodeGroup');settings.node_tree=group;nt.links.new(split.outputs['Red'],settings.inputs['Occlusion'])
 sidepaint=mat('matte carved side panels',(.112,.068,.018),.85,.67)
 sidepaint.use_nodes=True;sp=sidepaint.node_tree.nodes.get('Principled BSDF')
 st=sidepaint.node_tree.nodes.new('ShaderNodeTexImage');st.image=sidenormal
 sn=sidepaint.node_tree.nodes.new('ShaderNodeNormalMap');sn.inputs['Strength'].default_value=.9
 sidepaint.node_tree.links.new(st.outputs['Color'],sn.inputs['Color']);sidepaint.node_tree.links.new(sn.outputs['Normal'],sp.inputs['Normal'])
 sc=sidepaint.node_tree.nodes.new('ShaderNodeTexImage');sc.image=sidealbedo
 sidepaint.node_tree.links.new(sc.outputs['Color'],sp.inputs['Base Color'])
 so=sidepaint.node_tree.nodes.new('ShaderNodeTexImage');so.image=sideorm
 ss=sidepaint.node_tree.nodes.new('ShaderNodeSeparateColor');ss.mode='RGB'
 sidepaint.node_tree.links.new(so.outputs['Color'],ss.inputs['Color'])
 sidepaint.node_tree.links.new(ss.outputs['Green'],sp.inputs['Roughness']);sidepaint.node_tree.links.new(ss.outputs['Blue'],sp.inputs['Metallic'])
 sg=sidepaint.node_tree.nodes.new('ShaderNodeGroup');sg.node_tree=group
 sidepaint.node_tree.links.new(ss.outputs['Red'],sg.inputs['Occlusion'])
 # Circular radial tessellation follows the irregular pentagonal perimeter.
 count=160;radial=29;edge=[]
 for k in range(5):
  a=Vector(rim[k]);b=Vector(rim[(k+1)%5])
  for t in range(count//5):edge.append(a.lerp(b,t/(count//5)))
 v=[(0,0,.233+relief(0,0)*.15)];uv=[(.5,.5)]
 for r in range(1,radial+1):
  t=r/radial
  for p in edge:
   x=p.x*t;y=p.y*t;u=(x+.26)/.52;vv=(y+.20)/.40
   v.append((x,y,.215+.018*(1-t*t)+relief(2*u-1,2*vv-1)*.15))
   uv.append((u,vv))
 f=[]
 for k in range(count):f.append((0,1+k,1+(k+1)%count))
 for r in range(1,radial):
  a=1+(r-1)*count;b=1+r*count
  for k in range(count):f.extend(((a+k,b+k,b+(k+1)%count),(a+k,b+(k+1)%count,a+(k+1)%count)))
 o=mesh('domed sculptural lid relief',v,f,sculpt)
 layer=o.data.uv_layers.new(name='Relief UV')
 for poly in o.data.polygons:
  for li in poly.loop_indices:layer.data[li].uv=uv[o.data.loops[li].vertex_index]
 # Actual sharp raised almond eye rims. Three-dimensional pupil craters read
 # even when the lamp grazes the lid; the normal map supplies finer tool cuts.
 def lidheight(x,y):
  t=min(1,math.sqrt((x/.24)**2+(y/.18)**2))
  return .215+.018*(1-t*t)+relief(x/.26,y/.20)*.15
 for num,(cx,cy,wx,wy) in enumerate(((-.114,.052,.061,.030),(.078,-.058,.052,.027),(.080,.070,.046,.024))):
  for sign in (-1,1):
   verts=[];faces=[]
   for i in range(33):
    t=i/32;x=cx+wx*(2*t-1);y=cy+sign*wy*math.sin(math.pi*t)
    h=lidheight(x,y)
    verts.extend(((x,y-sign*.004,h+.003),(x,y,h+.014),(x,y+sign*.004,h+.003)))
   for i in range(32):
    a=i*3;b=(i+1)*3
    faces.extend(((a,a+1,b+1,b),(a+1,a+2,b+2,b+1)))
   mesh('sharp cast almond eye rim %d'%num,verts,faces,worn)
  # Four concentric rings form the inward sloping pit instead of a black dot.
  verts=[];faces=[]
  for radius,z in ((.019,.012),(.012,.005),(.006,-.002)):
   for k in range(24):
    a=2*math.pi*k/24;x=cx+radius*math.cos(a);y=cy+radius*.72*math.sin(a)
    verts.append((x,y,lidheight(x,y)+z))
  for r in range(2):
   for k in range(24):
    a=r*24+k;b=r*24+(k+1)%24;faces.append((a,b,b+24,a+24))
  mesh('deep pupil pit %d'%num,verts,faces,tarnish)
  ball('dark pupil floor %d'%num,(cx,cy,lidheight(cx,cy)-.001),(.006,.004,.001),pits,12)
 # Deep perimeter ribbon border and five side panels.
 for k in range(5):
  a=Vector(rim[k]);b=Vector(rim[(k+1)%5]);a2=Vector(hi[k]);b2=Vector(hi[(k+1)%5])
  rod('outer raised lid border',(a.x*.98,a.y*.98,.222),(b.x*.98,b.y*.98,.222),.005,worn,8)
  rod('inner raised lid border',(a.x*.86,a.y*.86,.228),(b.x*.86,b.y*.86,.228),.0045,worn,8)
  # 10 interlaced X knots on each border edge, as shallow cast strips.
  for q in range(10):
   t0=(q+.14)/10;t1=(q+.82)/10
   p0=a.lerp(b,t0);p1=a.lerp(b,t1)
   for flip in (-1,1):
    ia=.875 if flip==-1 else .955;ib=.955 if flip==-1 else .875
    x0,y0=p0.x*ia,p0.y*ia;x1,y1=p1.x*ib,p1.y*ib
    mesh('interlaced border knot',[(x0,y0,.233),(x0+.002,y0+.002,.235),(x1+.002,y1+.002,.235),(x1,y1,.233)],[(0,1,2,3)],worn)
  # One tightly framed relief panel per side, UV mapped to a carved normal.
  panel=[];panel_uv=[];cols=15;rows=7
  for j in range(rows+1):
   vz=j/rows;z=.066+.087*vz
   for i in range(cols+1):
    u=.07+.86*i/cols;p=a2.lerp(b2,u)
    panel.append((p.x*1.013,p.y*1.013,z+.002*side_sample(i/cols,vz)))
    panel_uv.append((i/cols,vz))
  faces=[]
  for j in range(rows):
   for i in range(cols):
    p=j*(cols+1)+i;faces.append((p,p+1,p+cols+2,p+cols+1))
  ob=mesh('carved writhing side panel %d'%k,panel,faces,sidepaint)
  uvlay=ob.data.uv_layers.new(name='Side relief UV')
  for poly in ob.data.polygons:
   for li in poly.loop_indices:uvlay.data[li].uv=panel_uv[ob.data.loops[li].vertex_index]
  for z in (.062,.158):rod('raised side panel frame',(a2.x*.99,a2.y*.99,z),(b2.x*.99,b2.y*.99,z),.006,worn,8)
  for p in (a2,b2):rod('raised side frame upright',(p.x*.99,p.y*.99,.062),(p.x*.99,p.y*.99,.158),.006,worn,8)
 # Three hinge barrels and their pins along the uneven rear edge.
 a=Vector(hi[3]);b=Vector(hi[4])
 for q in (.22,.5,.78):
  p=a.lerp(b,q);cyl('bronze hinge knuckle',(p.x,p.y+.020,.188),.023,.055,tarnish,12,(0,math.pi/2,0))
 rod('continuous hinge pin',(a.x,a.y+.018,.188),(b.x,b.y+.018,.188),.008,dark,8)
 cube('old hasp plate',(0,-.177,.123),(.058,.017,.095),tarnish,.009)
 ring('hasp loop',(0,-.188,.084),.024,.006,tarnish,(math.pi/2,0,0),16)
 for k in range(5):
  p=Vector(lo[k]);ring('corner barnacle scar',(p.x*1.014,p.y*1.014,.048),.011,.003,pits,seg=10)

def buoy():
 cyl('red buoy hull',(0,0,-.06),.78,.72,buoyred,24)
 ball('conical float top',(0,0,.33),(.73,.73,.22),buoyred,20)
 ring('rubber bumper',(0,0,-.28),.74,.07,dark)
 for z,r in ((.51,.49),(1.50,.25),(2.46,.09)):ring('cage hoop',(0,0,z),r,.035,buoyred)
 for i in range(4):
  a=i*math.pi/2+math.pi/4
  rod('bell cage tower leg',(.51*math.cos(a),.51*math.sin(a),.48),(.08*math.cos(a),.08*math.sin(a),2.45),.032,buoyred,8)
  rod('diagonal brace',(.4*math.cos(a),.4*math.sin(a),.97),(.22*math.cos(a+math.pi/2),.22*math.sin(a+math.pi/2),1.68),.018,steel,8)
 cyl('bell',(0,0,1.13),.18,.28,steel,16);ball('bell clapper',(0,0,.90),(.055,.055,.055),steel)
 cyl('light housing',(0,0,2.56),.16,.17,dark,16)
 ball('buoy_light',(0,0,2.70),(.13,.13,.14),navr)
 cyl('lamp cap',(0,0,2.84),.17,.035,dark,16)

def seabed():
 for i,(x,y,r) in enumerate([(-2.15,-.92,.6),(-1.12,1.18,.4),(1.9,1.16,.54),(2.3,-1.54,.35)]):
  n=9;v=[]
  for z,s in ((0,.87),(.23*r,1),(.68*r,.69),(r,.17)):
   for k in range(n):
    a=k*2*math.pi/n;noise=random.uniform(.83,1.13)
    v.append((x+math.cos(a)*r*s*noise,y+math.sin(a)*r*s*noise,z))
  f=[tuple(range(n-1,-1,-1))]+[(h*n+k,h*n+(k+1)%n,(h+1)*n+(k+1)%n,(h+1)*n+k) for h in range(3) for k in range(n)]+[tuple(range(3*n,4*n))]
  mesh('silted rock',v,f,silt if i%2 else steel)
 for i in range(11):
  x=-1.56+i*.27;y=-1.72+math.sin(i*.46)*.17
  o=ring('rusted chain link',(x,y,.07),.16,.027,rust,seg=16);o.scale=(1.18,.62,1);o.rotation_euler=(math.pi/2 if i%2 else .16,0,.2*math.sin(i*.45))
 o=cyl('crushed glass bottle',(1.33,-.44,.11),.115,.60,bottle,12,(0,math.pi/2,.23));o.scale=(1,.75,.53)
 rod('bottle neck',(1.64,-.35,.10),(1.84,-.30,.09),.047,bottle,10)
 ring('broken rim',(1.84,-.30,.09),.051,.009,bottle,(0,math.pi/2,.23),12)
 for i in range(4):
  x=1.19+random.random()*.7;y=-.69+random.random()*.5
  mesh('glass fragment',[(x,y,.01),(x+.08,y+.015,.01),(x+.02,y+.075,.018)],[(0,1,2)],bottle)

def seabed_v2():
 rockmat=mat('submerged brown grey stone with silt dust',(.080,.076,.067),.05,.91)
 vc=rockmat.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='SiltDust'
 rockmat.node_tree.links.new(vc.outputs['Color'],rockmat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 crust=mat('flaky dark chain rust',(.22,.065,.026),.32,.95)
 wood=mat('waterlogged timber',(.075,.052,.031),.04,.94)
 for i,(x,y,rx,ry,rz) in enumerate([(-2.16,-.90,.72,.52,.29),(-1.06,1.26,.44,.51,.24),(1.90,1.13,.62,.48,.32),(2.26,-1.56,.40,.36,.20)]):
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3,radius=1,location=(x,y,.005))
  o=bpy.context.object;o.name='displaced partly buried rock %d'%i;o.data.materials.append(rockmat)
  for v in o.data.vertices:
   p=v.co;wave=.10*math.sin(8*p.x+3*p.y+i)*math.sin(9*p.y-2*p.z)+.06*math.sin(15*p.z+4*p.x)
   cells=.045*math.sin(21*p.x+8*p.y)*math.cos(17*p.z-5*p.y)
   radial=1+wave+cells
   p.x*=rx*radial;p.y*=ry*radial;p.z*=rz*radial
   p.z-=.07 if i%2 else .04
  o.data.update()
  for poly in o.data.polygons:poly.use_smooth=True
  dust=o.data.vertex_colors.new(name='SiltDust')
  for poly in o.data.polygons:
   for li in poly.loop_indices:
    v=o.data.vertices[o.data.loops[li].vertex_index];up=max(0,min(1,(v.co.z+.04)/(.65*rz)))
    speck=.82+.18*random.random();base=(.060,.055,.048);top=(.20,.19,.15)
    dust.data[li].color=tuple((base[k]*(1-up)+top[k]*up)*speck for k in range(3))+(1,)
 # Each link lies on the floor in a shallow curve; alternating orientations
 # interlock and sink part of the links below the silt.
 for i in range(12):
  x=-1.75+i*.305;y=-1.73+.31*math.sin(i*.36)
  o=ring('heavy rusted chain link %02d'%i,(x,y,.024 if i%3 else -.012),.194,.046,rust,(math.pi/2 if i%2 else .16,0,.25*math.sin(i*.4)),20)
  o.scale=(1.12,.72,1)
  for j in range(2):
   angle=j*math.pi+.4*i
   ball('rust crust on chain',(x+math.cos(angle)*.14,y+math.sin(angle)*.07,.036),(.042,.026,.023),crust,8)
 # Wrenched lobster-pot frame: lower rectangle, three uprights, a twisted
 # partial crown and a collapsed funnel. Mesh panels have long since rotted.
 cx,cy=-.62,.57;hx,hy=.67,.43
 for z,ma in ((.03,rust),(.52,rust)):
  corners=[(cx-hx,cy-hy,z),(cx+hx,cy-hy,z),(cx+hx,cy+hy,z),(cx-hx,cy+hy,z)]
  for j in range(4 if z==.03 else 3):rod('broken lobster pot frame',corners[j],corners[(j+1)%4],.034,ma,10)
 for x,y in ((cx-hx,cy-hy),(cx+hx,cy-hy),(cx-hx,cy+hy)):
  rod('bent pot upright',(x,y,.03),(x+random.uniform(-.12,.12),y+random.uniform(-.09,.09),.52),.030,rust,10)
 rod('collapsed pot cross brace',(cx-hx,cy-hy,.48),(cx+.22,cy+hy,.16),.022,crust,9)
 rod('torn funnel rim',(cx+.35,cy-.20,.30),(cx+.61,cy+.06,.18),.023,rust,9)
 for j in range(4):
  yy=cy-hy+j*.28
  rod('pot wire remnant',(cx-hx,yy,.17),(cx+hx*.3,yy+.03,.10),.010,crust,6)
 # Long sunken plank with a splintered outline and two oxidized nail heads.
 px,py=1.06,-.31
 plankverts=[(-.78,-.16,-.025),(.68,-.14,-.04),(.79,-.09,-.038),(.72,.13,-.03),(-.62,.16,-.034),(-.8,.07,-.025)]
 topverts=[(a,b,c+.055) for a,b,c in plankverts]
 f=[tuple(range(len(plankverts)-1,-1,-1))]
 for j in range(len(plankverts)):
  k=(j+1)%len(plankverts);f.append((j,k,k+len(plankverts),j+len(plankverts)))
 f.append(tuple(range(len(plankverts),2*len(plankverts))))
 ob=mesh('sunken splintered plank',plankverts+topverts,f,wood);ob.location=(px,py,0);ob.rotation_euler[2]=.23
 for x in (-.46,.44):ball('rusted plank nail',(px+x,py+x*.23,.034),(.018,.018,.008),rust,8)
 for j in range(4):
  rod('timber grain groove',(px-.64,py-.08+j*.046,.033),(px+.61,py+.07+j*.046,.029),.003,crust,6)
 # The crushed bottle and a few loose shards remain from the original set.
 o=cyl('crushed bottle',(1.55,.13,.095),.11,.54,bottle,12,(0,math.pi/2,-.3));o.scale=(1,.74,.55)
 rod('bottle neck',(1.81,.05,.09),(2.02,-.01,.08),.046,bottle,10)
 ring('broken bottle rim',(2.02,-.01,.08),.047,.009,bottle,(0,math.pi/2,-.3),12)
 for j in range(4):
  x=1.3+random.random()*.5;y=-.10+random.random()*.5
  mesh('bottle shard',[(x,y,.012),(x+.06,y+.014,.011),(x+.02,y+.07,.015)],[(0,1,2)],bottle)

{'boat':boat,'box':box_v2,'buoy':buoy,'seabed':seabed_v2}[NAME]()
assets=list(bpy.context.scene.objects)
if NAME=='boat':
 for obj in assets:
  if obj.type=='MESH' and obj.data.materials and obj.data.materials[0] in (navy,navy_hull,white,red,orange,steel):boat_planar_uv(obj)
for o in assets:
 if o.type=='MESH':
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
  bpy.ops.object.convert(target='MESH');bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
if NAME=='boat':
 protected={'nav_red','nav_green','mast_white','deck_work_lamp','deck_work_lamp.001'}
 groups={}
 for o in list(bpy.context.scene.objects):
  if o.type!='MESH' or o.name in protected or o.name.startswith('flood_lamp'):continue
  key=o.data.materials[0].name if o.data.materials else 'unpainted'
  groups.setdefault(key,[]).append(o)
 for material,objs in groups.items():
  if len(objs)<2:continue
  bpy.ops.object.select_all(action='DESELECT')
  for o in objs:o.select_set(True)
  bpy.context.view_layer.objects.active=objs[0]
  bpy.ops.object.join();objs[0].name='boat '+material+' assembly'
 assets=list(bpy.context.scene.objects)
tri=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in assets if o.type=='MESH')
print('ASSET_TRIANGLES',NAME,tri)
bpy.ops.object.select_all(action='DESELECT')
for o in assets:o.select_set(True)
path=os.path.join(ROOT,NAME+'.glb')
bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_yup=True,
 export_image_format='JPEG',export_jpeg_quality=88,export_image_quality=88)
print('ASSET_EXPORTED',path,os.path.getsize(path))

# Preview-only stage, excluded from the exported GLB.
floor=mat('preview black sea' if NAME in ('boat','buoy') else 'preview dark silt',(.008,.017,.023) if NAME in ('boat','buoy') else (.036,.045,.047),.1,.75)
cube('preview floor',(0,0,-.22 if NAME in ('boat','buoy') else -.04),(80,80,.07),floor)
def area(n,loc,power,color,size,target):
 d=bpy.data.lights.new(n,'AREA');d.energy=power;d.color=color;d.shape='DISK';d.size=size
 o=bpy.data.objects.new(n,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
if NAME=='boat':cam=(-27,-11,16);target=(0,0,1.5);size=17.5;lights=[((-5,-4,12),2150,(.48,.58,.72),8),((1,-4,8),920,(1,.58,.31),5),((-8,1,4),660,(1,.70,.47),6)]
elif NAME=='buoy':cam=(5,-7,6);target=(0,0,1.2);size=5.4;lights=[((3,-3,7),1300,(.36,.53,1),5),((-3,1,5),650,(1,.42,.25),4)]
elif NAME=='box':cam=(.7,-.8,.65);target=(0,0,.11);size=.86;lights=[((1,-2,3),160,(.30,.47,.7),2.5),((-1,1,2),220,(1,.72,.42),1.6),((1,-1,1.8),95,(.42,.57,.72),2.2)]
else:cam=(7,-9,7);target=(0,0,.15);size=8;lights=[((2,-3,7),1100,(.30,.50,.71),6),((-3,1,4),900,(1,.7,.43),4)]
for i,(loc,power,color,diam) in enumerate(lights):area('preview light '+str(i),loc,power,color,diam,target)
if NAME=='boat':
 for i,loc in enumerate(((-.78,-6.56,2.35),(.78,-6.56,2.35))):
  d=bpy.data.lights.new('preview warm deck light '+str(i),'POINT');d.energy=350;d.color=(1,.60,.32);d.shadow_soft_size=.24
  p=bpy.data.objects.new(d.name,d);bpy.context.collection.objects.link(p);p.location=loc
 d=bpy.data.lights.new('preview stern lamp spill','POINT');d.energy=700;d.color=(1,.58,.30);d.shadow_soft_size=.25
 p=bpy.data.objects.new(d.name,d);bpy.context.collection.objects.link(p);p.location=(0,-8.55,2.45)
d=bpy.data.cameras.new('preview camera');o=bpy.data.objects.new('preview camera',d);bpy.context.collection.objects.link(o)
o.location=cam;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=size;bpy.context.scene.camera=o
bpy.context.scene.world.color=(.007,.009,.014)
bpy.context.scene.render.engine='BLENDER_EEVEE';bpy.context.scene.render.resolution_x=1200;bpy.context.scene.render.resolution_y=800
bpy.context.scene.view_settings.view_transform='AgX'
bpy.context.scene.view_settings.look='AgX - Medium High Contrast'
bpy.context.scene.view_settings.exposure=-1.1 if NAME in ('box','seabed') else -.3
bpy.context.scene.render.resolution_percentage=100;bpy.context.scene.render.image_settings.file_format='PNG'
preview=os.path.join(ROOT,'preview','boat_v88.png' if NAME=='boat' else NAME+'.png');os.makedirs(os.path.dirname(preview),exist_ok=True)
bpy.context.scene.render.filepath=preview;bpy.ops.render.render(write_still=True)
print('ASSET_PREVIEW',preview)
if NAME=='boat':
 o.location=(13,-17,12);o.rotation_euler=(Vector((0,-1.2,1.8))-o.location).to_track_quat('-Z','Y').to_euler();d.ortho_scale=12.5
 close=os.path.join(ROOT,'preview','boat_texture_close.png')
 bpy.context.scene.render.filepath=close;bpy.ops.render.render(write_still=True)
 print('ASSET_PREVIEW_CLOSE',close)
