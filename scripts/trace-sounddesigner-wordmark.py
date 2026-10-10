"""Trace the supplied transparent wordmark into smooth, independent SVG paths.

Usage: python scripts/trace-sounddesigner-wordmark.py path/to/Sound-logo.png
Requires Pillow and NumPy. No fonts or bitmap data are embedded in the output.
"""
from pathlib import Path
import sys
from collections import defaultdict
import numpy as np
from PIL import Image


def simplify(points, tolerance):
    if len(points) <= 2:
        return points
    chord = points[-1] - points[0]
    length = np.linalg.norm(chord)
    offset = points - points[0]
    distances = (np.abs(chord[0]*offset[:,1] - chord[1]*offset[:,0]) / length
                 if length > 1e-9 else np.linalg.norm(points - points[0], axis=1))
    index = int(np.argmax(distances))
    if distances[index] <= tolerance:
        return points[[0, -1]]
    return np.concatenate((simplify(points[:index + 1], tolerance)[:-1],
                           simplify(points[index:], tolerance)))


def unit(vector):
    length = np.linalg.norm(vector)
    return vector / length if length > 1e-9 else np.array([1., 0.])


def fit(points, left, right, tolerance=.65):
    if len(points) == 2:
        length = np.linalg.norm(points[-1] - points[0]) / 3
        return [(points[0], points[0] + left * length,
                 points[-1] + right * length, points[-1])]
    lengths = np.linalg.norm(np.diff(points, axis=0), axis=1)
    t = np.r_[0., np.cumsum(lengths)]
    t /= t[-1]
    basis = np.array([(1-t)**3, 3*t*(1-t)**2, 3*t*t*(1-t), t**3]).T
    a = np.stack((basis[:, 1, None] * left, basis[:, 2, None] * right), axis=2)
    base = ((basis[:, 0] + basis[:, 1])[:, None] * points[0]
            + (basis[:, 2] + basis[:, 3])[:, None] * points[-1])
    alphas = np.linalg.lstsq(a.reshape(-1, 2), (points-base).ravel(), rcond=None)[0]
    chord = np.linalg.norm(points[-1]-points[0])
    if min(alphas) < chord * 1e-5 or max(alphas) > chord * 4:
        alphas[:] = chord/3
    curve = np.array([points[0], points[0]+left*alphas[0],
                      points[-1]+right*alphas[1], points[-1]])
    errors = np.linalg.norm(basis @ curve - points, axis=1)
    index = int(np.argmax(errors))
    if errors[index] <= tolerance:
        return [curve]
    index = min(len(points)-2, max(1, index))
    tangent = unit(points[index-1]-points[index+1])
    return (fit(points[:index+1], left, tangent, tolerance)
            + fit(points[index:], -tangent, right, tolerance))


def trace(source):
    image = Image.open(source).convert('RGBA')
    bounds = image.getchannel('A').getbbox()
    if not bounds:
        raise ValueError('The source has no visible artwork')
    x0, y0, x1, y1 = bounds
    width, height = x1-x0, y1-y0
    alpha = np.pad(np.asarray(image.crop(bounds).getchannel('A'), dtype=float), 2)
    a, b, c, d = alpha[:-1, :-1], alpha[:-1, 1:], alpha[1:, 1:], alpha[1:, :-1]
    cases = ((a >= 127.5).astype(int) + 2*(b >= 127.5)
             + 4*(c >= 127.5) + 8*(d >= 127.5))
    rows, cols = np.where((cases > 0) & (cases < 15))
    positions, adjacency = {}, defaultdict(list)
    table = {1:[(3,0)], 2:[(0,1)], 3:[(3,1)], 4:[(1,2)],
             5:[(3,0),(1,2)], 6:[(0,2)], 7:[(3,2)], 8:[(2,3)],
             9:[(0,2)], 10:[(0,1),(2,3)], 11:[(1,2)],
             12:[(1,3)], 13:[(0,1)], 14:[(3,0)]}
    for y, x in zip(rows, cols):
        keys = [('h',y,x), ('v',y,x+1), ('h',y+1,x), ('v',y,x)]
        pairs = table[int(cases[y,x])]
        if cases[y,x] in (5,10) and (a[y,x]+b[y,x]+c[y,x]+d[y,x])/4 >= 127.5:
            pairs = [(3,2),(0,1)] if cases[y,x] == 5 else [(3,0),(1,2)]
        for e1,e2 in pairs:
            for edge in (e1,e2):
                key = keys[edge]
                if key not in positions:
                    axis, yy, xx = key
                    first = alpha[yy,xx]
                    second = alpha[yy,xx+1] if axis == 'h' else alpha[yy+1,xx]
                    fraction = (127.5-first)/(second-first)
                    positions[key] = np.array([xx+(fraction if axis=='h' else 0)-1.5,
                                               yy+(fraction if axis=='v' else 0)-1.5])
            p, q = keys[e1], keys[e2]
            adjacency[p].append(q)
            adjacency[q].append(p)
    assert all(len(neighbors)==2 for neighbors in adjacency.values()), 'Open contour'
    visited, contours = set(), []
    for start in adjacency:
        if start in visited:
            continue
        current, previous, loop = start, None, []
        while current not in visited:
            visited.add(current)
            loop.append(positions[current])
            neighbors = adjacency[current]
            following = neighbors[0] if neighbors[0] != previous else neighbors[1]
            previous, current = current, following
        if len(loop) > 8:
            contours.append(np.array(loop))
    paths, total_curves = [], 0
    for loop in contours:
        # Simplify the sampled alpha boundary before fitting smooth cubic curves.
        opposite = int(np.argmax(np.linalg.norm(loop-loop[0],axis=1)))
        poly = np.concatenate((simplify(loop[:opposite+1],.32)[:-1],
                               simplify(np.r_[loop[opposite:],loop[:1]],.32)[:-1]))
        corners=[]
        for i in range(len(poly)):
            before=unit(poly[i]-poly[i-1])
            after=unit(poly[(i+1)%len(poly)]-poly[i])
            if np.dot(before,after) < .65:
                corners.append(i)
        if len(corners)<2:
            corners=sorted(set(corners+[0,len(poly)//2]))
        # Fit against the dense source contour, not only the simplified vertices.
        # Otherwise a long straight stem can bow between sparsely sampled endpoints.
        corners=sorted({int(np.argmin(np.linalg.norm(loop-poly[i],axis=1))) for i in corners})
        curves=[]
        for i, start in enumerate(corners):
            end=corners[(i+1)%len(corners)]
            segment = loop[start:end+1] if end>start else np.r_[loop[start:],loop[:end+1]]
            curves.extend(fit(segment,unit(segment[1]-segment[0]),
                              unit(segment[-2]-segment[-1])))
        n=lambda p: f'{p[0]:.3f} {p[1]:.3f}'
        paths.append('M'+n(curves[0][0])+''.join('C'+n(q[1])+' '+n(q[2])+' '+n(q[3]) for q in curves)+'Z')
        total_curves += len(curves)
    destination=Path(__file__).resolve().parent.parent/'.github/assets/SoundDesigner-wordmark.svg'
    markup=(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="wordmark-title">\n'
            '<title id="wordmark-title">SoundDesigner supplied wordmark</title>\n'
            '<desc>Vector trace of the user-supplied Sound-logo.png. Sound uses SF Pro Display; '
            'Designer uses Bodoni Moda. Original lettering and cream color preserved.</desc>\n'
            f'<path fill="#fffee5" fill-rule="evenodd" d="{"".join(paths)}"/>\n</svg>\n')
    destination.write_text(markup,encoding='utf-8')
    print(f'{destination}: {width} x {height}, {len(contours)} contours, {total_curves} cubic curves')


if __name__ == '__main__':
    trace(sys.argv[1])
