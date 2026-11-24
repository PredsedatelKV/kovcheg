"""Build the original 3D tree, its twenty decorations and the character wardrobe."""
from array import array
import gzip
import json
from math import cos, sin, pi, sqrt, tau
from pathlib import Path
from random import Random
import struct
import sys

DEST = Path(sys.argv[1])
CATALOG = Path(sys.argv[2])
DEST.mkdir(parents=True, exist_ok=True)
VERTEX = struct.Struct("<3h3b9B")
COLORS = {
    "gold": "#f5bd57", "cream": "#fff4d8", "wood": "#8b5032",
    "red": "#d62f4d", "pink": "#f77bad", "berry": "#a21b40", "violet": "#a663e8",
    "ice": "#a3deff", "blue": "#389bf0", "teal": "#53ebcb",
    "green": "#3bd291", "bronze": "#cb7854", "navy": "#283b64",
}


def add(a, b): return tuple(x + y for x, y in zip(a, b))
def sub(a, b): return tuple(x - y for x, y in zip(a, b))
def mul(a, b): return tuple(x * b for x in a)
def dot(a, b): return sum(x * y for x, y in zip(a, b))
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def norm(a): return mul(a, 1 / max(sqrt(dot(a, a)), 1e-8))
def mix(a,b,t): return tuple(x+(y-x)*t for x,y in zip(a,b))


def color(value):
    value = COLORS.get(value, value)
    return tuple(int(value[i:i+2], 16) for i in (1, 3, 5))


def material(value, metal=.05, rough=.48, glow=0.0):
    rgb = color(value)
    return (*rgb, *(round(component * glow) for component in rgb), round(rough*255), round(metal*255), 127)


class Mesh:
    def __init__(self):
        self.vertices = []
        self.indices = []

    def vertex(self, position, normal, surface):
        self.vertices.append((position, normal, surface))
        return len(self.vertices) - 1

    def quad(self, a,b,c,d):
        self.indices.extend((a,b,c,a,c,d))

    def extend(self, other, offset=(0,0,0), scale=1, yaw=0):
        c,s = cos(yaw),sin(yaw)
        def rotate(v): return (v[0]*c+v[2]*s,v[1],-v[0]*s+v[2]*c)
        start = len(self.vertices)
        self.vertices.extend((add(mul(rotate(pos),scale),offset),rotate(normal),surface)
                             for pos,normal,surface in other.vertices)
        self.indices.extend(i+start for i in other.indices)

    def encoded(self, recenter=False):
        if not self.vertices:
            raise ValueError("Empty model")
        center = tuple((min(p[i] for p,_,_ in self.vertices)+max(p[i] for p,_,_ in self.vertices))/2 for i in range(3))
        if not recenter:
            center = (0,0,0)
        radius = max(sqrt(dot(sub(p,center),sub(p,center))) for p,_,_ in self.vertices)
        parts = []
        lookup = {}
        vertex_bytes = bytearray()
        indices = array("H")
        for tri in range(0,len(self.indices),3):
            if len(lookup)>65533:
                parts.append((len(lookup),vertex_bytes,indices))
                lookup,vertex_bytes,indices = {},bytearray(),array("H")
            for index in self.indices[tri:tri+3]:
                if index not in lookup:
                    p,n,surface = self.vertices[index]
                    lookup[index] = len(lookup)
                    vertex_bytes += VERTEX.pack(*(round(v*8192) for v in sub(p,center)),
                                                *(round(v*127) for v in n), *surface)
                indices.append(lookup[index])
        parts.append((len(lookup),vertex_bytes,indices))
        return struct.pack("<4sHHf",b"KBOX",2,len(parts),radius)+b"".join(
            struct.pack("<II",n,len(indices))+vertices+indices.tobytes()
            for n,vertices,indices in parts)


def lathe(mesh, center, profile, mat, rings=16):
    first=len(mesh.vertices)
    for j,(y,r) in enumerate(profile):
        previous=profile[max(0,j-1)]
        following=profile[min(len(profile)-1,j+1)]
        dy=following[0]-previous[0]
        dr=following[1]-previous[1]
        for i in range(rings):
            t=tau*i/rings
            n=norm((dy*cos(t),-dr,dy*sin(t)))
            mesh.vertex(add(center,(r*cos(t),y,r*sin(t))),n,mat(j,i) if callable(mat) else mat)
    for j in range(len(profile)-1):
        for i in range(rings):
            next_i=(i+1)%rings
            a=first+j*rings
            mesh.quad(a+i,a+rings+i,a+rings+next_i,a+next_i)


def ellipsoid(mesh, center, radii, mat, sides=12, rows=8, yaw=0):
    start=len(mesh.vertices)
    for j in range(rows+1):
        phi=-pi/2+pi*j/rows
        for i in range(sides):
            theta=tau*i/sides
            v=(cos(phi)*cos(theta),sin(phi),cos(phi)*sin(theta))
            pos=tuple(v[i]*radii[i] for i in range(3))
            normal=norm(tuple(v[i]/radii[i] for i in range(3)))
            def rotate(v): return (cos(yaw)*v[0]+sin(yaw)*v[2],v[1],-sin(yaw)*v[0]+cos(yaw)*v[2])
            mesh.vertex(add(center,rotate(pos)),rotate(normal),mat(j,i) if callable(mat) else mat)
    for j in range(rows):
        for i in range(sides):
            a=start+j*sides
            n=(i+1)%sides
            mesh.quad(a+i,a+sides+i,a+sides+n,a+n)


def tube(mesh, points, radii, mat, sides=8):
    start=len(mesh.vertices)
    for j,p in enumerate(points):
        tangent=norm(sub(points[min(j+1,len(points)-1)],points[max(0,j-1)]))
        anchor=(0,1,0) if abs(tangent[1])<.94 else (0,0,1)
        a=norm(cross(tangent,anchor))
        b=cross(a,tangent)
        for i in range(sides):
            phi=tau*i/sides
            n=add(mul(a,cos(phi)),mul(b,sin(phi)))
            mesh.vertex(add(p,mul(n,radii[j] if isinstance(radii,list) else radii)),n,mat(j,i) if callable(mat) else mat)
    for j in range(len(points)-1):
        for i in range(sides):
            k=start+j*sides
            n=(i+1)%sides
            mesh.quad(k+i,k+sides+i,k+sides+n,k+n)


def box(mesh, center, size, mat, bevel=.06):
    ext=tuple(n/2 for n in size)
    for normal,u,v in (
        ((0,0,1),(1,0,0),(0,1,0)), ((0,0,-1),(-1,0,0),(0,1,0)),
        ((1,0,0),(0,0,-1),(0,1,0)), ((-1,0,0),(0,0,1),(0,1,0)),
        ((0,1,0),(1,0,0),(0,0,-1)), ((0,-1,0),(1,0,0),(0,0,1)),
    ):
        a=len(mesh.vertices)
        for j in (-1,-.70,.70,1):
            for i in (-1,-.70,.70,1):
                point=tuple(ext[k]*(normal[k]+u[k]*i+v[k]*j) for k in range(3))
                r=tuple(max(-ext[k]+bevel,min(ext[k]-bevel,point[k])) for k in range(3))
                n=norm(sub(point,r))
                mesh.vertex(add(center,add(r,mul(n,bevel))),n,mat)
        for j in range(3):
            for i in range(3):
                k=a+j*4+i
                mesh.quad(k,k+1,k+5,k+4)


def plate(mesh, outline, center, depth, mat, side=None):
    ox,oy,oz=center
    # A star or crescent is triangulated as a fan from a known interior point.
    n=len(outline)
    front=mesh.vertex((ox,oy,oz+depth/2),(0,0,1),mat)
    rear=mesh.vertex((ox,oy,oz-depth/2),(0,0,-1),side or mat)
    edge_a=[mesh.vertex((ox+x,oy+y,oz+depth/2), (0,0,1),mat) for x,y in outline]
    edge_b=[mesh.vertex((ox+x,oy+y,oz-depth/2), (0,0,-1),side or mat) for x,y in outline]
    for i in range(n):
        j=(i+1)%n
        mesh.indices.extend((front,edge_a[i],edge_a[j],rear,edge_b[j],edge_b[i]))
        a,b=outline[i],outline[j]
        normal=norm((b[1]-a[1],a[0]-b[0],0))
        k=len(mesh.vertices)
        for x,y,z in [(a[0],a[1],-depth/2),(b[0],b[1],-depth/2),(b[0],b[1],depth/2),(a[0],a[1],depth/2)]:
            mesh.vertex((ox+x,oy+y,oz+z),normal,side or mat)
        mesh.quad(k,k+1,k+2,k+3)


def star(mesh, size):
    outline=[(cos(i*pi/5+pi/2)*size*(1 if i%2==0 else .50),
              sin(i*pi/5+pi/2)*size*(1 if i%2==0 else .50)) for i in range(10)]
    plate(mesh, outline, (0,0,0), size*.30, material("gold", .65, .19), material("#db854c", .6, .24))
    for x,y in outline[::2]:
        tube(mesh,[(0,0,.083),(x*.82,y*.82,.049)], .012, material("cream",.55,.24),5)


GREEN=[material(c, .04, .67) for c in ("#103c28", "#175337", "#1e673f", "#2a7a47", "#329251", "#45a561", "#62bc6d")]


def make_tree():
    tree=Mesh()
    rng=Random(891)
    lathe(tree,(0,0,0),[(-2.52,.13),(-2.48,.20),(-2.19,.21),(-1.43,.13),(1.9,.019),(2.63,.006)],
          lambda j,i: material(("#79503b","#8c5a3b","#a8744a","#69412b")[i%4],.05,.82),12)
    for layer,(height,radius,count) in enumerate([
        (-1.94,1.54,11),(-1.56,1.49,11),(-1.13,1.31,10),(-.68,1.17,10),
        (-.20,1.00,9),(.25,.83,9),(.68,.65,8),(1.04,.49,7),(1.42,.34,6),(1.77,.235,5),(2.03,.14,5)]):
        for b in range(count):
            angle=tau*b/count+layer*.62+rng.uniform(-.07,.07)
            length=radius*rng.uniform(.89,1.1)
            y=height+rng.uniform(-.10,.10)
            direction=(cos(angle),0,sin(angle))
            side=(-sin(angle),0,cos(angle))
            leaf_colors=[GREEN[max(0,min(6,layer//3+k))] for k in range(5)]
            # Each bough has a lifted central tip and natural, staggered lateral sprays.
            start=len(tree.vertices)
            for j in range(10):
                t=j/9
                belly=(sin(pi*t)**.8)*length
                tip_y=y+.42*(1-t)-.22*sin(pi*t*.85)+.10*t**6
                for i in range(12):
                    theta=tau*i/12
                    scallop=.94+.06*sin(11*t+theta*3+layer*.55)
                    w=cos(theta)*(.035+belly*.34*scallop)
                    h=sin(theta)*(.015+belly*.14)
                    p=add(add(mul(direction,length*t),mul(side,w)),(0,tip_y+h,0))
                    n=norm(add(mul(side,cos(theta)),(0,sin(theta),0)))
                    shade=min(4, round(1.9*(sin(theta)+1)+t*.41))
                    tree.vertex(p,n,leaf_colors[shade])
            for j in range(9):
                for i in range(12):
                    k=start+j*12
                    n=(i+1)%12
                    tree.quad(k+i,k+12+i,k+12+n,k+n)
            for n in (-1,1):
                for t in (.54,.73,.87):
                    point=add(add(mul(direction,length*t),mul(side,length*n*(.19-.11*t))),(0,y+.08-t*.16,0))
                    ellipsoid(tree,point,(length*.25,length*.075,length*.071), leaf_colors[3], 6,4, -angle+n*.38)
    lathe(tree,(0,0,0),[(1.88,.19),(2.05,.16),(2.22,.105),(2.39,.068),(2.55,.032),(2.65,.001)], GREEN[4],12)
    return tree


CATALOG_ROWS = [
    ("tree_bauble_k","Рубиновый шар «К»","Игрушки","Обычный"),
    ("tree_bauble_snow","Шар «Снежинка»","Игрушки","Редкий"),
    ("tree_bauble_cube","Шар «Белый куб»","Игрушки","Редкий"),
    ("tree_bauble_marble","Шар «Северный мрамор»","Игрушки","Эпический"),
    ("tree_box_bronze","Бронзовые ковбоксики","Игрушки","Редкий"),
    ("tree_box_legend","Радужные ковбоксики","Игрушки","Легендарный"),
    ("tree_toys_crystal","Хрустальные сосульки","Игрушки","Редкий"),
    ("tree_bell_gold","Золотые колокольчики","Игрушки","Редкий"),
    ("tree_candy_cane","Мятные леденцы","Игрушки","Обычный"),
    ("tree_orange_slice","Апельсиновые дольки","Игрушки","Обычный"),
    ("tree_bow_crimson","Малиновые банты","Игрушки","Обычный"),
    ("tree_pinecone","Кедровые шишки","Игрушки","Обычный"),
    ("tree_moon","Лунные подвески","Игрушки","Эпический"),
    ("tree_garland_aurora","Гирлянда «Северное сияние»","Гирлянды","Эпический"),
    ("tree_lights_gold","Янтарные огоньки","Гирлянды","Редкий"),
    ("tree_garland_pearls","Жемчужные бусы","Гирлянды","Редкий"),
    ("tree_garland_ribbon","Алая атласная лента","Гирлянды","Эпический"),
    ("tree_snow_soft","Искусственный снег","Под ёлкой","Редкий"),
    ("tree_gifts_festive","Подарки под ёлкой","Под ёлкой","Эпический"),
    ("tree_star_north","Вифлеемская звезда","Верхушка","Легендарный"),
]


def hanging_cap(mesh,y):
    lathe(mesh,(0,y,0),[(-.032,.067),(.01,.070),(.037,.06),(.042,.008)],material("gold",.73,.25),12)
    tube(mesh,[(.034*sin(t*tau/12),y+.045+.037*cos(t*tau/12),0) for t in range(13)], .008,material("gold",.6,.22),5)


def ornament(index):
    m=Mesh()
    gold=material("gold",.63,.23)
    cream=material("cream",.07,.44)
    if index<4:
        def finish(j,i):
            col=["red","blue","violet","teal"][index]
            if index==3:
                col=("teal","navy","gold","green")[(i//3+j//2)%4] if (i+j)%5<3 else "teal"
            return material(col,.58,.20)
        ellipsoid(m,(0,0,0),(.23,.239,.23),finish,20,12)
        hanging_cap(m,.237)
        if index==0:
            for points in [[(-.065,-.104),(-.065,.096)],[(-.060,-.007),(.078,.085)],[(-.058,-.006),(.083,-.092)]]:
                tube(m,[(x,y,.227) for x,y in points], .017,gold,7)
        elif index==1:
            for angle in [i*tau/6 for i in range(6)]:
                a=(cos(angle),sin(angle))
                path=[(x*a[0],x*a[1],.232-.25*x*x) for x in (0,.07,.156)]
                tube(m,path,.010,cream,5)
                for sign in (-1,1):
                    f=angle+sign*.72
                    tube(m,[(.096*a[0],.096*a[1],.229),(.096*a[0]+.051*cos(f),.096*a[1]+.051*sin(f),.222)],.009,cream,5)
        elif index==2:
            points=[(-.105,-.063),(-.105,.067),(0,.131),(.105,.067),(.105,-.063),(0,-.119)]
            for a,b in list(zip(points,points[1:]+points[:1]))+[(points[1],(0,.007)),(points[3],(0,.007)),(points[5],(0,.007))]:
                tube(m,[(x,y,.22) for x,y in (a,b)],.012,cream,6)
        else:
            path=[(.225*cos(t*tau/40),.065*sin(t*tau/20),.226*sin(t*tau/40)) for t in range(41)]
            tube(m,path,.010,gold,6)
    elif index in (4,5):
        box(m,(0,0,0),(.34,.34,.34),material("bronze" if index==4 else "violet", .69,.24),.036)
        trim=[gold]*4 if index==4 else [material(c,.55,.18,.12) for c in ("pink","teal","gold","violet")]
        for y in (-.145,.145):
            for i,(x,z,w,d) in enumerate([(.15,0,.029,.315),(-.15,0,.029,.315),(0,.15,.315,.029),(0,-.15,.315,.029)]):
                box(m,(x,y,z),(w,.041,d),trim[i],.010)
        box(m,(0,0,.17),(.20,.22,.032),gold,.015)
        for a,b in [((-.048,-.078),(-.048,.075)),((-.046,.0),(.048,.07)),((-.046,0),(.048,-.074))]:
            tube(m,[(x,y,.190) for x,y in (a,b)],.010,material("navy",.2,.51),5)
        hanging_cap(m,.17)
    elif index==6:
        lathe(m,(0,0,0),[(-.31,.005),(-.025,.109),(.082,.073),(.184,.018)],
              lambda j,i: material(("#8ccefa","#d7f9ff","#69b3ee")[i%3],.37,.19,.07),6)
        hanging_cap(m,.18)
    elif index==7:
        lathe(m,(0,0,0),[(-.145,.16),(-.115,.179),(-.093,.142),(-.044,.112),(.045,.097),(.12,.066),(.14,.01)],gold,20)
        ellipsoid(m,(0,-.172,0),(.045,.039,.045),material("#d68c48", .65,.21))
        hanging_cap(m,.15)
    elif index==8:
        path=[(-.108,-.23+.022*j,0) for j in range(15)]
        path += [(.032+.14*cos(pi-t*pi/19),.078+.136*sin(t*pi/19),0) for t in range(1,20)]
        tube(m,path,.043,lambda j,i: material("red" if (j+i//3)//3%2 else "cream",.08,.24),10)
    elif index==9:
        lathe(m,(0,0,0),[(-.038,.002),(-.037,.212),(.034,.212),(.038,.002)],material("#ffab49",.03,.47),22)
        lathe(m,(0,0,0),[(-.036,.231),(.035,.231)],material("#d8782c",.05,.55),22)
        for i in range(8):
            phi=tau*i/8
            for sign in (-1,1):
                tube(m,[(0,sign*.040,0),(.192*cos(phi),sign*.04,.192*sin(phi))],.012,cream,5)
        angle=pi*.45
        def tilt(v): return (v[0],cos(angle)*v[1]-sin(angle)*v[2],sin(angle)*v[1]+cos(angle)*v[2])
        m.vertices=[(tilt(pos),tilt(normal),mat) for pos,normal,mat in m.vertices]
        hanging_cap(m,.212)
    elif index==10:
        for s in (-1,1):
            path=[(s*.26*sin(t*pi/16),.074+.127*sin(t*tau/16),.074*sin(pi*t/16)) for t in range(17)]
            tube(m,path,[.020+.026*sin(t*pi/16) for t in range(17)],material("red",.22,.31),8)
            tube(m,[(s*.03,0,.012),(s*.12,-.115,-.011),(s*.19,-.203,.019)],.036,material("berry",.22,.31),8)
        ellipsoid(m,(0,.068,.02),(.067,.056,.045),gold)
    elif index==11:
        ellipsoid(m,(0,0,0),(.133,.216,.128),material("#8c5439",.03,.71))
        for j in range(6):
            for i in range(6):
                t=tau*i/6+j*.46
                r=.11*sin(pi*(j+.84)/7)+.035
                ellipsoid(m,(r*cos(t),.18-.060*j,r*sin(t)),(.047,.061,.033),
                          material(("#bb7c50","#955e42","#70442e")[(i+j)%3],.03,.73),6,4,t)
        hanging_cap(m,.21)
    elif index==12:
        path=[(.182*cos(i*pi/16+.47),.22*sin(i*pi/16+.47),0) for i in range(23)]
        tube(m,path,[.054*(sin(pi*i/22)**.5)+.013 for i in range(23)],gold,10)
        ellipsoid(m,(.125,.121,.019),(.022,.022,.022),material("cream",.62,.24,.28))
    return m


def wrap_point(angle,height,radius):
    return (radius*cos(angle),height,radius*sin(angle))


def garland(which, icon=False):
    m=Mesh()
    points=[]
    steps=120 if not icon else 36
    for i in range(steps+1):
        t=i/steps
        if icon:
            points.append((.50*(t-.5),-.088*sin(pi*t),0))
        else:
            angle=tau*3.42*t+which*1.28
            y=-1.97+4.13*t+.035*sin(tau*6*t)
            points.append(wrap_point(angle,y,1.57*(1-t)**1.08+.125))
    scale=1 if not icon else 1.20
    if which==3:
        for i,(a,b) in enumerate(zip(points,points[1:])):
            side=norm(cross(norm(sub(b,a)),(0,1,0)))
            mat=material("red" if i%6<4 else "berry",.28,.35)
            k=len(m.vertices)
            for p,w in [(a,-.055),(b,-.055),(b,.055),(a,.055)]:
                m.vertex(add(p,(0,w,0)),side,mat)
            m.quad(k,k+1,k+2,k+3)
            m.quad(k+3,k+2,k+1,k)
    else:
        tube(m,points,.014,material("#526344" if which<2 else "gold",.19,.55),6)
        for i,p in enumerate(points[::(4 if which<2 else 3)]):
            colors=("pink","teal","gold","ice","violet") if which==0 else ("gold","cream") if which==1 else ("cream","red","gold")
            col=colors[i%len(colors)]
            size=(.039 if which!=1 else .027)*scale
            ellipsoid(m,p,(size,size*(1.2 if which!=2 else 1),size),material(col,.32,.22,.36 if which!=2 else .03),7,5)
    return m


def snow(tree=True):
    m=Mesh()
    rng=Random(628)
    frost=[material(c,0,.88) for c in ("#c6e3f5","#e9faff","#fcfdff")]
    if tree:
        for j,(y,r) in enumerate([(-1.66,1.20),(-1.24,1.08),(-.75,.98),(-.34,.88),(.16,.72),(.60,.54),(1.03,.44),(1.45,.31),(1.83,.20)]):
            for i in range(8):
                angle=tau*i/8+j*.60
                p=wrap_point(angle,y+rng.uniform(-.085,.085),r*rng.uniform(.85,1.05))
                ellipsoid(m,p,(r*.24,.056+r*.05,r*.15),frost[(i+j)%3],8,5,-angle)
        ellipsoid(m,(0,-2.49,0),(1.52,.139,1.34),frost[1],25,8)
        for i in range(11):
            theta=i*tau/11
            ellipsoid(m,wrap_point(theta,-2.46,rng.uniform(.90,1.31)),(.35,.095,.258),frost[i%3],10,6,theta)
    else:
        for i in range(5):
            ellipsoid(m,((i-2)*.12,.035*(i%2),0),(.15,.098+(i%3)*.02,.155),frost[i%3])
    return m


def gifts(icon=False):
    m=Mesh()
    for i,(x,z,size,col,yaw) in enumerate(((-.57,.73,.49,"red",.31),(.46,1.04,.47,"violet",-.32),(.88,.29,.40,"teal",.3))):
        if icon and i>1:
            break
        p=Mesh()
        box(p,(0,0,0),(size,size*.78,size),material(col,.30,.37),.035)
        ribbon=material("gold" if i!=2 else "cream",.4,.31)
        for a,b in [(size*.09,size+.011),(size+.011,size*.10)]:
            box(p,(0,size*.38,0),(a,.032,b),ribbon,.011)
        for side in (-1,1):
            tube(p,[(side*.148*sin(j*pi/10),size*.40+.107*sin(j*pi/10),.055*sin(j*tau/10)) for j in range(11)],.024,ribbon,7)
        m.extend(p,(x if not icon else (i-.40)*.32,-2.46+size*.38 if not icon else size*.28, z if not icon else 0),yaw=yaw)
    return m


def make_decor():
    models,thumbs={},{}
    for index,(code,*_) in enumerate(CATALOG_ROWS):
        if index<13:
            sample=ornament(index)
            layer=Mesh()
            for j in range(4 if index in (4,5,7) else 5):
                tier=(index*3+j*2)%9
                y=-1.86+tier*.44+(index%3)*.085
                r=(1.57-(y+1.9)*.319)*(.93+(index%3)*.037)
                phi=(j*2.39996+index*1.231)
                scale=.60 if tier<5 else .48
                layer.extend(sample,wrap_point(phi,y-.11,r+.055),scale,pi/2-phi+.12)
        elif index<17:
            sample=garland(index-13,True)
            layer=garland(index-13)
        elif index==17:
            sample=snow(False)
            layer=snow()
        elif index==18:
            sample=gifts(True)
            layer=gifts()
        else:
            sample=Mesh()
            star(sample,.35)
            layer=Mesh()
            layer.extend(sample,(0,2.68,0),.83,.10)
        models[code]=layer
        thumbs[code]=sample
    return models,thumbs


HUMAN_PALETTES=[
    ("skin_head_hair","head","#5c3629"),("skin_head_ushanka","head","#8b5946"),
    ("skin_head_iron_helm","head","#a2b0c5"),("skin_head_crown","crown","#edb54a"),
    ("skin_torso_tshirt","torso","#5696db"),("skin_torso_telnyashka","stripe","#4368b5"),
    ("skin_torso_chainmail","armor","#879cb8"),("skin_torso_mantle","mantle","#703fa7"),
    ("skin_legs_jeans","legs","#425677"),("skin_legs_vatniki","legs","#697958"),
    ("skin_legs_plates","legs","#9baec5"),("skin_legs_parade","parade","#343754"),
    ("skin_feet_sneakers","feet","#cdd7ed"),("skin_feet_sapogi","feet","#70504b"),
    ("skin_feet_bercy","feet","#45505f"),("skin_feet_golden","feet","#dba542"),
]


def make_person():
    m=Mesh()
    skin=material("#efb889",.02,.67)
    shadow=material("#8b5740",.0,.62)
    ellipsoid(m,(0,1.20,0),(.58,.65,.46),skin,20,14)
    ellipsoid(m,(0,.59,0),(.24,.30,.24),skin)
    ellipsoid(m,(0,-.03,0),(.57,.65,.31),material("#50839e"),16,11)
    for s in (-1,1):
        ellipsoid(m,(s*.56,1.13,.003),(.117,.166,.121),skin)
        ellipsoid(m,(s*.24,1.23,.421),(.060,.083,.038),material("#382b35"),10,8)
        ellipsoid(m,(s*.23,1.26,.452),(.019,.022,.011),material("cream"),6,4)
        ellipsoid(m,(s*.62,-.25,.013),(.19,.61,.21),material("#50839e"))
        ellipsoid(m,(s*.65,-.77,.026),(.16,.20,.18),skin)
        ellipsoid(m,(s*.275,-1.03,0),(.243,.54,.254),material("#344b68"))
        ellipsoid(m,(s*.27,-1.54,.12),(.248,.18,.37),material("#664438"))
    ellipsoid(m,(0,1.10,.447),(.092,.083,.085),skin)
    tube(m,[(-.09,1.008,.418),(0,.990,.441),(.089,1.011,.419)],.018,shadow,6)
    return m


def garment(kind, color_hex, code):
    m=Mesh()
    mat=material(color_hex,.54 if kind in {"armor","crown"} or "helm" in code else .08,.32)
    if kind=="crown":
        lathe(m,(0,1.59,0),[(0,.48),(.035,.52),(.205,.52)],mat,24)
        for i in range(8):
            a=i*tau/8
            ellipsoid(m,wrap_point(a,1.83,.49),(.09,.12,.09),mat,10,6)
        ellipsoid(m,(0,1.729,.525),(.112,.075,.039),material("red",.55,.23),8,6)
    elif kind=="head":
        lathe(m,(0,1.19,-.012),[(.127,.561),(.30,.553),(.44,.515),(.61,.376),(.70,.04)],mat,21)
        if "ushanka" in code or "helm" in code:
            for s in (-1,1):
                ellipsoid(m,(s*.527,1.237,-.007),(.12,.322,.275),mat)
        if "hair" in code:
            for i in range(4):
                ellipsoid(m,(-.378+.23*i,1.548+.046*i,.348),(.179,.213,.25),mat,9,6,-.2)
    elif kind in ("torso","stripe","armor","mantle"):
        def bands(j,i):
            return material("cream" if j%3==1 else color_hex,.08,.56)
        ellipsoid(m,(0,-.031,.012),(.581,.664,.329),bands if kind=="stripe" else mat,18,12)
        for s in (-1,1):
            ellipsoid(m,(s*.62,-.258,.015),(.211,.55,.233),mat)
        if kind=="armor":
            box(m,(0,.072,.319),(.56,.56,.125),mat,.12)
        if kind=="mantle":
            ellipsoid(m,(0,-.43,-.31),(.68,.80,.16),mat)
            tube(m,[(-.52,.38,.248),(0,.274,.349),(.52,.38,.248)], .055,material("gold",.5,.29),9)
    elif kind in ("legs","parade"):
        for s in (-1,1):
            ellipsoid(m,(s*.272,-1.029,.01),(.254,.55,.268),mat)
            if kind=="parade":
                tube(m,[(s*.458,-.57,.147),(s*.491,-.97,.164),(s*.429,-1.44,.142)],.024,material("gold",.42,.32),7)
    else:
        for s in (-1,1):
            ellipsoid(m,(s*.273,-1.48,.014),(.259,.243,.271),mat)
            ellipsoid(m,(s*.272,-1.565,.137),(.255,.179,.373),mat)
    return m


def package(models,path, reframe=False):
    data=bytearray()
    index={}
    for name,mesh in models.items():
        block=mesh.encoded(recenter=reframe)
        index[name]=[len(data),len(block)]
        data+=block
    path.write_bytes(data)
    with path.with_suffix(".bin.gz").open("wb") as target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=target,mtime=0) as packed:
            packed.write(data)
    return index


decor,preview=make_decor()
wardrobe={code:garment(kind,tint,code) for code,kind,tint in HUMAN_PALETTES}
models={"tree":make_tree(),**decor,"person":make_person(),
        "person_hair_default":garment("head","#604232","skin_head_hair"),**wardrobe}
index=package(models,DEST/"models.bin")
thumbnails={**preview, **wardrobe}
thumb_index=package(thumbnails,DEST/"thumbnail-source.bin",True)
(DEST/"models.json").write_text(json.dumps(index,separators=(",",":")),encoding="utf8")
(DEST/"thumbnail-source.json").write_text(json.dumps(thumb_index,separators=(",",":")),encoding="utf8")
CATALOG.write_text(json.dumps([dict(zip(("code","name","group","rarity"),r)) for r in CATALOG_ROWS],
                             ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print(len(models), "models", len(thumbnails), "thumbnail sources")
