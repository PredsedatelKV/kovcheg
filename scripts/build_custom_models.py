"""Build the 3D tree, decorations and character wardrobe.

Pass the model output directory, the catalogue JSON path, and the directory
created by export_ornament_boxes.py.
"""
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
BOX_MODELS = Path(sys.argv[3])
DEST.mkdir(parents=True, exist_ok=True)
VERTEX = struct.Struct("<3h3b9B")

DECOR_LIGHTS = ("tree_garland_aurora", "tree_lights_gold")
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
        self.lights = None

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
                    if self.lights is not None:
                        vertex_bytes += bytes(self.lights(p, n))
                indices.append(lookup[index])
        parts.append((len(lookup),vertex_bytes,indices))
        return struct.pack("<4sHHf",b"KBOX",3 if self.lights is not None else 2,len(parts),radius)+b"".join(
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
    steps = (-1, -.70, .70, 1) if bevel else (-1, 1)
    side = len(steps)
    for normal,u,v in (
        ((0,0,1),(1,0,0),(0,1,0)), ((0,0,-1),(-1,0,0),(0,1,0)),
        ((1,0,0),(0,0,-1),(0,1,0)), ((-1,0,0),(0,0,1),(0,1,0)),
        ((0,1,0),(1,0,0),(0,0,-1)), ((0,-1,0),(1,0,0),(0,0,1)),
    ):
        a=len(mesh.vertices)
        for j in steps:
            for i in steps:
                point=tuple(ext[k]*(normal[k]+u[k]*i+v[k]*j) for k in range(3))
                r=tuple(max(-ext[k]+bevel,min(ext[k]-bevel,point[k])) for k in range(3))
                n=norm(sub(point,r)) if bevel else normal
                mesh.vertex(add(center,add(r,mul(n,bevel))),n,mat)
        for j in range(side-1):
            for i in range(side-1):
                k=a+j*side+i
                mesh.quad(k,k+1,k+side+1,k+side)


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


GREEN = [material(c, .02, .72) for c in
         ("#093425", "#114933", "#175f3b", "#237744", "#318c49", "#4ba553", "#6bbd5d")]


def foliage_fan(mesh, root, angle, length, width, thickness, tip, shade, subdivisions):
    axis = (cos(angle), 0, sin(angle))
    side = (-sin(angle), 0, cos(angle))
    rings = 8
    vertices = []
    for row in range(subdivisions + 1):
        t = row / subdivisions
        spread = sin(pi*t) ** .87
        plate = 1 + .095 * sin(5*pi*t) * spread
        bend = tip * t - length * .12 * sin(pi*t)
        row_points = []
        for ring in range(rings):
            alpha = tau * ring / rings
            across = cos(alpha) * (.004 + width * spread) * plate
            rise = sin(alpha) * (.002 + thickness * spread)
            row_points.append(add(root, add(mul(axis, length*t), add(mul(side, across), (0, bend + rise, 0)))))
        vertices.append(row_points)
    start = len(mesh.vertices)
    for row, row_points in enumerate(vertices):
        t = row / subdivisions
        for k, p in enumerate(row_points):
            lengthwise = sub(vertices[min(row+1, subdivisions)][k], vertices[max(row-1, 0)][k])
            crosswise = sub(row_points[(k+1) % rings], row_points[(k-1) % rings])
            normal = norm(cross(lengthwise, crosswise))
            tint = int(max(0, min(6, shade + normal[1]*1.1 + 1.2*t)))
            visibility = round(77 + 50*min(1, .25 + t*.88 + max(0,normal[1])*.39))
            mesh.vertex(p, normal, (*GREEN[tint][:-1], visibility))
    for j in range(subdivisions):
        for i in range(rings):
            k = start + j*rings
            next_i = (i+1) % rings
            mesh.quad(k+i, k+rings+i, k+rings+next_i, k+next_i)


def light_sampler():
    bulbs = [(which, point, color(tint)) for which in range(2) for point, tint in bulbs_for(which)]
    bins = {}
    for bulb in bulbs:
        bins.setdefault(int(bulb[1][1] * 4), []).append(bulb)

    def sample(point, normal):
        tint = [0.0, 0.0, 0.0, 0.0]
        band = int(point[1] * 4)
        for nearby in range(band - 2, band + 3):
            for kind, bulb, rgb in bins.get(nearby, ()):
                ray = sub(bulb, point)
                distance_sq = dot(ray, ray)
                if distance_sq > .19:
                    continue
                distance = sqrt(distance_sq)
                angle = .30 + .70 * max(0, dot(norm(ray), normal))
                fade = (1 - distance / .44) ** 2 * angle
                if kind == 0:
                    for i in range(3):
                        tint[i] += (rgb[i]/255) ** 2 * fade
                else:
                    tint[3] += fade
        return tuple(round(max(0, min(1, light)) * 255) for light in tint)

    return sample


def make_tree():
    tree = Mesh()
    tree.lights = light_sampler()
    rng = Random(891)
    lathe(tree, (0,0,0),
          [(-2.51,.13),(-2.47,.20),(-2.19,.20),(-1.43,.13),(1.46,.049),(2.51,.009)],
          lambda j,i: material(("#785038","#84563a","#ad7853","#68402c")[i%4],.02,.87), 16)
    for layer, (height, radius, count) in enumerate([
        (-1.96,1.46,12),(-1.64,1.42,12),(-1.26,1.28,11),(-.91,1.14,10),(-.55,1.04,10),
        (-.16,.91,9),(.22,.80,9),(.62,.69,8),(.96,.56,8),(1.29,.44,7),
        (1.60,.36,7),(1.88,.265,6),(2.09,.205,5),(2.27,.146,5),(2.41,.097,4),(2.52,.060,4),
    ]):
        for index in range(count):
            angle = tau * index / count + layer*.69 + rng.uniform(-.065,.065)
            length = radius * rng.uniform(.91,1.11)
            y = height + rng.uniform(-.124,.124) * min(1,radius*3)
            shade = 1.7 + rng.uniform(0, 2.0)
            sweep = rng.uniform(.12, .26)
            foliage_fan(tree, (0,y+.18*length,0), angle, length, .268*length, .094*length,
                        -sweep*length + .14*layer/15, shade, 11)
            for sign in (-1,1):
                side = (-sin(angle)*sign,0,cos(angle)*sign)
                for t in (.30, .48, .66, .80):
                    wing = add((length*t*cos(angle),y+.12*length-t*sweep*length,length*t*sin(angle)),
                               mul(side, length*(.07+.10*t)))
                    reach = length*(.59-.30*t)*rng.uniform(.86,1.13)
                    foliage_fan(tree, wing, angle+sign*(.96-.49*t), reach, .17*reach, .077*reach,
                                -.12*reach, min(4.8,shade+.64), 6)
            if layer > 3:
                foliage_fan(tree, (0,y-.15,0), angle+.27, length*.63, length*.16, length*.05,
                            length*.15, shade-.4, 7)
    for i in range(5):
        angle = i*tau/5
        foliage_fan(tree, (0,2.43,0), angle, .054+i*.008, .028, .035, .225-i*.012, 5, 6)
    return tree


CATALOG_ROWS = [
    ("tree_bauble_k","Рубиновый шар «К»","Игрушки","Обычный"),
    ("tree_bauble_snow","Шар «Снежинка»","Игрушки","Редкий"),
    ("tree_bauble_cube","Шар «Ковчег»","Игрушки","Редкий"),
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


def original_box(variant):
    data = (BOX_MODELS / f"{variant}.bin").read_bytes()
    magic, version, count, _ = struct.unpack_from("<4sHHf", data)
    if magic != b"KBOX" or version != 2:
        raise ValueError("Expected original KBOX model")
    offset = 12
    mesh = Mesh()
    for _ in range(count):
        vertices, indices = struct.unpack_from("<II", data, offset)
        offset += 8
        start = len(mesh.vertices)
        for _ in range(vertices):
            raw = VERTEX.unpack_from(data, offset)
            pos = tuple(v / 8192 for v in raw[:3])
            normal = norm(tuple(v / 127 for v in raw[3:6]))
            mesh.vertices.append((pos, normal, raw[6:]))
            offset += VERTEX.size
        mesh.indices.extend(start + i for (i,) in struct.iter_unpack("<H", data[offset:offset+indices*2]))
        offset += indices * 2
    return mesh


def globe_face(mesh, corners, mat, divisions=5):
    def project(x, y):
        z = .004 + .23 * sqrt(max(0,1 - (x/.23)**2 - (y/.239)**2))
        normal = norm((x/.23, y/.239, z/.23))
        return mesh.vertex((x,y,z), normal, mat)

    def patch(points):
        a,b,c = points
        current = {}
        for i in range(divisions+1):
            for j in range(divisions-i+1):
                u,v=i/divisions,j/divisions
                current[i,j] = project(a[0]*(1-u-v)+b[0]*u+c[0]*v,
                                       a[1]*(1-u-v)+b[1]*u+c[1]*v)
        for i in range(divisions):
            for j in range(divisions-i):
                mesh.indices.extend((current[i,j],current[i+1,j],current[i,j+1]))
                if i+j+1 < divisions:
                    mesh.indices.extend((current[i+1,j],current[i+1,j+1],current[i,j+1]))

    a,b,c,d = corners
    patch((a,b,c))
    patch((a,c,d))


def ornament(index):
    m=Mesh()
    gold=material("gold",.63,.23)
    cream=material("cream",.07,.44)
    if index<4:
        def finish(j,i):
            col=["red","blue","#c51f36","teal"][index]
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
            bottom = (0,-.124)
            lower_left, upper_left = (-.115,-.056),(-.115,.070)
            lower_right, upper_right = (.115,-.056),(.115,.070)
            top, center = (0,.14),(0,.002)
            globe_face(m,(lower_left,bottom,center,upper_left),material("#f1f4fa",.08,.35))
            globe_face(m,(bottom,lower_right,upper_right,center),material("#c7d4e4",.08,.35))
            globe_face(m,(upper_left,center,upper_right,top),material("#ffffff",.08,.31))
        else:
            path=[(.225*cos(t*tau/40),.065*sin(t*tau/20),.226*sin(t*tau/40)) for t in range(41)]
            tube(m,path,.010,gold,6)
    elif index in (4,5):
        model = original_box("bronze" if index==4 else "rainbow")
        m.extend(model,scale=.155)
        hanger_y = max(p[1] for p,_,_ in m.vertices) + .017
        hanging_cap(m,hanger_y)
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


GARLAND_COLORS = [
    ("pink","teal","gold","ice","violet"), ("gold","cream"), ("cream","red","gold"),
]


def garland_points(which, icon=False):
    points = []
    steps = 124 if not icon else 36
    for i in range(steps+1):
        t=i/steps
        if icon:
            points.append((.50*(t-.5),-.088*sin(pi*t),0))
        else:
            angle=tau*3.7*t+which*1.46
            height=-1.97+4.23*t+.043*sin(tau*7*t)
            radius=1.46*(1-t)**1.07+.124 + .025*sin(angle*6)
            points.append(wrap_point(angle,height,radius))
    return points


def bulbs_for(which, icon=False):
    palette = GARLAND_COLORS[which]
    points = garland_points(which,icon)[::(4 if which<2 else 3)]
    return [(point,palette[i%len(palette)]) for i,point in enumerate(points)]


def garland(which, icon=False):
    m=Mesh()
    points=garland_points(which,icon)
    if which==3:
        for i,(a,b) in enumerate(zip(points,points[1:])):
            side=norm(cross(norm(sub(b,a)),(0,1,0)))
            mat=material("red" if i%6<4 else "berry",.28,.35)
            k=len(m.vertices)
            for p,w in [(a,-.049),(b,-.049),(b,.049),(a,.049)]:
                m.vertex(add(p,(0,w,0)),side,mat)
            m.quad(k,k+1,k+2,k+3)
            m.quad(k+3,k+2,k+1,k)
    else:
        tube(m,points,.010,material("#546943" if which<2 else "gold",.19,.55),6)
        for point, col in bulbs_for(which,icon):
            size=(.035 if which!=1 else .028)*(1.2 if icon else 1)
            ellipsoid(m,point,(size,size*(1.17 if which<2 else 1),size),
                      material(col,.27,.19,.78 if which<2 else .045),8,6)
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


# All pieces use the same body grid, so sleeves, trousers and boots
# can be replaced independently without drawing two shells in one slot.
FOOT_Y = -1.805
PIXEL = .115
LIMB = 4 * PIXEL
HEAD = 8 * PIXEL
BODY = 12 * PIXEL
WAIST_Y = FOOT_Y + BODY
SHOULDER_Y = WAIST_Y + BODY
ARM_X = (HEAD + LIMB) / 2
LEG_X = LIMB / 2
SHOE_HEIGHT = .317
FABRIC = .70


def voxel(mesh, point, size, tint, *, metal=0, rough=FABRIC, bevel=.016, shade=1):
    surface = material(tint, metal, rough)
    box(mesh, point, size, (*surface[:-1], round(shade * 127)), bevel)


def pixels(mesh, rows, palette, x, y, z, cell, *, back=False, metal=0):
    normal = (0, 0, -1 if back else 1)
    for j, row in enumerate(rows):
        for i, tone in enumerate(row):
            if tone == ".":
                continue
            left, bottom = x + i * cell, y - (j+1) * cell
            surface = material(palette[tone], metal, .60)
            start = len(mesh.vertices)
            for dx, dy in ((0,0), (cell,0), (cell,cell), (0,cell)):
                mesh.vertex((left+dx, bottom+dy, z), normal, surface)
            if back:
                mesh.quad(start, start+3, start+2, start+1)
            else:
                mesh.quad(start, start+1, start+2, start+3)


def make_person():
    mesh = Mesh()
    voxel(mesh, (0, SHOULDER_Y + HEAD / 2, 0), (HEAD, HEAD, HEAD), "#e8af83", rough=.64, bevel=0)
    pixels(mesh, [
        "........",
        "........",
        "........",
        "XL....LX",
        "WE....EW",
        "B..NN..B",
        "...MM...",
        "........",
    ], {"X":"#6b4034","L":"#a56b51","W":"#fff1d1","E":"#254350","B":"#d28e75",
        "N":"#c68b6a","M":"#9d5a57"}, -.408, 1.809, .462, .102)
    for side in (-1, 1):
        exposed = BODY - .46
        voxel(mesh, (side * ARM_X, WAIST_Y + exposed / 2, 0),
              (LIMB, exposed, LIMB - .004), "#e8af83", shade=.91, bevel=0)
    return mesh


def person_ground():
    mesh = Mesh()
    surface = material("#151d2d")
    for x, z in ((-1.20,.85), (1.20,.85), (1.20,-.98), (-1.20,-.98)):
        mesh.vertex((x, FOOT_Y-.012, z), (0,1,0), surface)
    mesh.quad(0,1,2,3)
    return mesh


def headpiece(mesh, code, tint):
    if code == "skin_head_hair":
        voxel(mesh, (0, 1.805, -.011), (.964, .19, .962), tint, bevel=.011)
        voxel(mesh, (0, 1.589, -.426), (.94, .34, .13), "#523225")
        for side in (-1,1):
            voxel(mesh, (side*.416, 1.670, -.114), (.125, .25, .682), "#65402c")
        pixels(mesh, ["HHHHHHHH", "HMLHHLL.", "H.H...L."],
               {"H":tint,"L":"#815139","M":"#4d2f25"}, -.46, 1.886, .473, .115)
        return
    if code == "skin_head_crown":
        gold = "#efba55"
        for z in (-.403, .403):
            voxel(mesh, (0,1.846,z), (.97,.147,.158), gold, metal=.54, rough=.28)
            for x in (-.402, 0, .402):
                voxel(mesh, (x,1.970 + (.016 if x == 0 else 0),z), (.143,.15,.155), tint, metal=.53, rough=.25)
        for x in (-.402, .402):
            voxel(mesh, (x,1.846,0), (.159,.146,.80), gold, metal=.54, rough=.28)
            voxel(mesh, (x,1.972,0), (.153,.15,.13), tint, metal=.53, rough=.26)
        voxel(mesh, (0,1.873,.495), (.151,.132,.035), "#c13b59", metal=.34, rough=.22)
        voxel(mesh, (-.024,1.908,.515), (.044,.039,.01), "#ff9a98", rough=.28, bevel=.004)
        return
    iron = code == "skin_head_iron_helm"
    trim = "#c2d4e3" if iron else "#d8ae93"
    voxel(mesh, (0,1.793,0), (1.013,.251,1.008), tint, metal=.53 if iron else .02, rough=.37 if iron else .80)
    voxel(mesh, (0,1.563,-.421), (.99,.34,.178), tint, metal=.48 if iron else .02)
    for side in (-1,1):
        voxel(mesh, (side*.441,1.494,-.063), (.155,.48,.677), tint, metal=.48 if iron else .02)
        voxel(mesh, (side*.525,1.461,.098), (.021,.27,.292), trim, metal=.42 if iron else .02, bevel=.006)
    voxel(mesh, (0,1.687,.492), (.70,.172,.08), trim, metal=.46 if iron else .01, rough=.45)


def outfit(mesh, kind, tint):
    metal = .36 if kind == "armor" else 0
    voxel(mesh, (0,WAIST_Y + BODY / 2,0), (HEAD,BODY,LIMB), tint, metal=metal, bevel=0)
    long_sleeve = kind != "torso"
    for side in (-1, 1):
        length = .92 if long_sleeve else .46
        voxel(mesh, (side * ARM_X, SHOULDER_Y-length/2,0), (LIMB,length,LIMB),
              tint, metal=metal, shade=.91, bevel=0)
        if kind == "armor":
            voxel(mesh, (side*.689,.645,.012), (.445,.31,.505), "#a1b6c7", metal=.47, rough=.29)
        elif kind == "stripe":
            for y in (.09,.33,.57):
                voxel(mesh, (side*ARM_X,y,0), (LIMB,.101,LIMB+.006), "#e2e0d0", bevel=0)
    if kind == "stripe":
        for y in (-.303,-.049,.205,.459,.713):
            voxel(mesh, (0,y,0), (HEAD,.105,LIMB+.006), "#e6e4d7", bevel=0)
    elif kind == "armor":
        pixels(mesh, ["L.L.L.L.",".L.L.L.L","L.L.L.L.",".L.L.L.L","L.L.L.L.",".L.L.L.L",
                      "L.L.L.L.",".L.L.L.L","L.L.L.L."],
               {"L":"#a9bac8"}, -.412,.688,.240,.103,metal=.41)
        voxel(mesh, (0,-.378,0), (.929,.126,.49), "#515968", metal=.21)
        voxel(mesh, (0,-.372,.254), (.166,.127,.051), "#d9b267", metal=.45)
    elif kind == "mantle":
        voxel(mesh, (0,-.164,-.284), (1.047,1.823,.132), "#6e3ba2", rough=.59)
        for y in (.696,-1.042):
            voxel(mesh, (0,y,-.286), (1.052,.093,.141), "#cf9e56", metal=.20, rough=.47)
        pixels(mesh, ["..G..",".G.G.","G...G",".G.G.","..G.."],
               {"G":"#dcac5a"}, -.275, .275, -.352,.11,back=True,metal=.13)
        voxel(mesh, (0,.65,.251), (.25,.161,.081), "#edba56", metal=.48, rough=.32)
        voxel(mesh, (0,.651,.297), (.087,.087,.035), "#a24477", metal=.30, rough=.24)
    else:
        voxel(mesh, (0,.726,.237), (.385,.124,.024), "#284954", bevel=.008)
        pixels(mesh, ["A...A","A..A.","A.A..","AA...","A.A..","A..A.","A...A"],
               {"A":"#e2ce9c"}, -.161,.496,.240,.065)


def trousers(mesh, kind, tint, code):
    plate = code == "skin_legs_plates"
    puffy = code == "skin_legs_vatniki"
    for side in (-1,1):
        x = side*LEG_X
        height = BODY - SHOE_HEIGHT
        voxel(mesh, (x, WAIST_Y - height / 2, 0), (LIMB,height,LIMB), tint,
              metal=.38 if plate else 0, shade=.90 if side < 0 else .94, bevel=0)
        if kind == "parade":
            voxel(mesh, (x+side*.174,-.964,.23), (.056,1.029,.026), "#d4a873", bevel=.004)
        elif plate:
            voxel(mesh, (x,-.984,.222), (.335,.317,.084), "#b6c7d3", metal=.46, rough=.36)
        elif puffy:
            for offset in (-.117,0,.117):
                voxel(mesh, (x+offset,-.968,.231), (.022,.995,.018), "#596b52", bevel=.005)
        else:
            voxel(mesh, (x,-.586,.227), (.251,.222,.028), "#57748d", bevel=.01)
            voxel(mesh, (x,-1.445,0), (LIMB,.101,LIMB+.005), "#374f62", bevel=0)


def boots(mesh, tint, code):
    gold = code == "skin_feet_golden"
    for side in (-1,1):
        x = side*LEG_X
        mid = (.084 + SHOE_HEIGHT) / 2
        voxel(mesh, (x,FOOT_Y+mid,0), (LIMB,SHOE_HEIGHT-.084,LIMB), tint,
              metal=.51 if gold else .02, rough=.34 if gold else .66, shade=.94 if side < 0 else 1, bevel=0)
        sole = "#644622" if gold else "#30343f"
        voxel(mesh, (x,FOOT_Y+.042,0), (LIMB,.084,LIMB), sole, bevel=0)
        if code == "skin_feet_sneakers" or code == "skin_feet_bercy":
            for y in (.149,.197,.245):
                voxel(mesh, (x,FOOT_Y+y,LIMB/2), (.225,.023,.016),
                      "#f3ead9" if code == "skin_feet_sneakers" else "#8797a2", bevel=.004)
        elif gold:
            voxel(mesh, (x,FOOT_Y+.16,LIMB/2), (.278,.104,.025), "#f4c665", metal=.56, rough=.26, bevel=.009)


def garment(kind, tint, code):
    mesh = Mesh()
    if kind in ("head", "crown"):
        headpiece(mesh, code, tint)
    elif kind in ("torso", "stripe", "armor", "mantle"):
        outfit(mesh, kind, tint)
    elif kind in ("legs", "parade"):
        trousers(mesh, kind, tint, code)
    else:
        boots(mesh, tint, code)
    return mesh


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
defaults = {
    "person_hair_default": garment("head", "#65402c", "skin_head_hair"),
    "person_torso_default": garment("torso", "#407c87", "default"),
    "person_legs_default": garment("legs", "#40596f", "default"),
    "person_feet_default": garment("feet", "#835b49", "default"),
}
models={"tree":make_tree(),**decor,"person":make_person(),"person_ground":person_ground(),**defaults,**wardrobe}
index=package(models,DEST/"models.bin")
thumbnails={**preview, **wardrobe}
thumb_index=package(thumbnails,DEST/"thumbnail-source.bin",True)
(DEST/"lights.json").write_text(json.dumps({
    code: [[*[round(c,5) for c in pos], *[component / 255 for component in color(tint)]]
           for pos,tint in bulbs_for(which)]
    for which,code in enumerate(DECOR_LIGHTS)
},separators=(",",":")),encoding="utf8")
(DEST/"models.json").write_text(json.dumps(index,separators=(",",":")),encoding="utf8")
(DEST/"thumbnail-source.json").write_text(json.dumps(thumb_index,separators=(",",":")),encoding="utf8")
CATALOG.write_text(json.dumps([dict(zip(("code","name","group","rarity"),r)) for r in CATALOG_ROWS],
                             ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print(len(models), "models", len(thumbnails), "thumbnail sources")
