#!/usr/bin/env python3
"""
Bleed tab fractal generator.

Reimplements the fractal noise algorithm from src/pages/fractalPlayground.ts
in Python and renders it as an SVG, centered on an A6 page. Intended for
generating print-ready bleed tab artwork for the book's fore edge.
"""

import argparse
import math
import random
import sys

ROOT_CELL_SCALE = 8
UNCLAIMED, CLAIMED, MID, MID_GAP, GAP = 0, 1, 2, 3, 4

MM_PER_INCH = 25.4
# A6 organizer/planner size (Filofax Pocket etc.), not ISO 216 A6 (105x148mm).
A6_WIDTH_MM = 105.0
A6_HEIGHT_MM = 173.0
DPI = 96.0


class SeededRNG:
    """Matches the LCG used by fractalPlayground.ts's SeededRNG."""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF
        if self.s & 0x80000000:
            self.s -= 0x100000000

    def next(self):
        self.s = (self.s * 1664525 + 1013904223) & 0x7FFFFFFF
        return self.s / 0x7FFFFFFF

    def rand_range(self, n):
        return int(self.next() * n)


def lattice_to_pixel(i, j, geo, drift_rate):
    origin, e1, e2, unit_len, drift_scale = geo
    dx = (i * unit_len) * e1[0] + (j * unit_len) * e2[0]
    dy = (i * unit_len) * e1[1] + (j * unit_len) * e2[1]
    r = math.hypot(dx, dy)
    swirl = drift_rate * drift_scale / (r + drift_scale)
    theta = math.atan2(dy, dx) + swirl
    return (origin[0] + r * math.cos(theta), origin[1] + r * math.sin(theta))


def build_lattice(global_origin, initial_angle, cell_scale, required, lattice,
                   step_i, step_j, segments, gaps, geo, drift_rate,
                   i_odds, j_odds, rng):
    def k(i, j):
        return (i, j)

    def is_unclaimed(gi, gj):
        return lattice.get(k(gi, gj), UNCLAIMED) == UNCLAIMED

    global_positions = {(0, 0): global_origin}
    parent_edge = {}

    frontier = [(0, 0, step_i, 0), (0, 0, 0, step_j)]

    while frontier:
        idx = rng.rand_range(len(frontier))
        i, j, ni, nj = frontier[idx]
        frontier[idx] = frontier[-1]
        frontier.pop()

        gstart = global_positions[(i, j)]
        is_i_step = (ni == i + step_i and nj == j)
        gstep = (cell_scale * step_i, 0) if is_i_step else (0, cell_scale * step_j)
        angle = initial_angle + (math.pi / 4 if is_i_step else -math.pi / 4)
        gend = (gstart[0] + gstep[0], gstart[1] + gstep[1])

        mid_indices = []
        for m in range(1, cell_scale):
            mid_indices.append((
                gstart[0] + (gstep[0] * m) / cell_scale,
                gstart[1] + (gstep[1] * m) / cell_scale,
            ))

        if not is_unclaimed(*gend) or any(not is_unclaimed(mi, mj) for mi, mj in mid_indices):
            pe = parent_edge.get((i, j))
            if pe:
                pgstart, pgend = pe
                gmid = ((pgstart[0] + pgend[0]) / 2, (pgstart[1] + pgend[1]) / 2)
                mid = lattice_to_pixel(gmid[0], gmid[1], geo, drift_rate)
                outward = (mid[0] - geo[0][0], mid[1] - geo[0][1])
                direction = (math.cos(angle), math.sin(angle))
                if (outward[0] * direction[0] + outward[1] * direction[1] > 0
                        and is_unclaimed(*gmid)):
                    lattice[k(*gmid)] = GAP
                    gaps.append((gmid, initial_angle, step_i, step_j, None))
            continue

        if k(*gend) not in required:
            continue

        lattice[k(*gstart)] = CLAIMED
        lattice[k(*gend)] = CLAIMED

        half = cell_scale / 2
        for m in range(1, cell_scale):
            mi = mid_indices[m - 1]
            seed_scale = m & -m
            status_code = MID_GAP if seed_scale == half else MID
            lattice[k(*mi)] = status_code
            gaps.append((mi, initial_angle, step_i, step_j, seed_scale))

        gaps.append((gstart, initial_angle, step_i, step_j, None))
        gaps.append((gend, initial_angle, step_i, step_j, None))

        global_positions[(ni, nj)] = gend
        parent_edge[(ni, nj)] = (gstart, gend)

        is_axis_edge = (gstart[0] == gend[0] and gstart[0] == 0) or \
                       (gstart[1] == gend[1] and gstart[1] == 0)
        if not is_axis_edge:
            points = [gstart] + mid_indices + [gend]
            for m in range(len(points) - 1):
                ai, aj = points[m]
                bi, bj = points[m + 1]
                segments.append((ai, aj, bi, bj, cell_scale))

        t = (math.log2(cell_scale) / math.log2(ROOT_CELL_SCALE)) if cell_scale > 1 else 0
        eff_i_odds = 1.0 - t * (1.0 - i_odds)
        eff_j_odds = 1.0 - t * (1.0 - j_odds)
        if rng.next() < eff_i_odds:
            frontier.append((ni, nj, ni + step_i, nj))
        if rng.next() < eff_j_odds:
            frontier.append((ni, nj, ni, nj + step_j))


def frontier_blocked(gstart, cell_scale, required, lattice, step_i, step_j):
    def k(i, j):
        return (i, j)

    def is_unclaimed(gi, gj):
        return lattice.get(k(gi, gj), UNCLAIMED) == UNCLAIMED

    for gstep in [(cell_scale * step_i, 0), (0, cell_scale * step_j)]:
        gend = (gstart[0] + gstep[0], gstart[1] + gstep[1])
        if k(*gend) not in required:
            continue
        mids = []
        for m in range(1, cell_scale):
            mids.append((gstart[0] + (gstep[0] * m) / cell_scale,
                         gstart[1] + (gstep[1] * m) / cell_scale))
        if is_unclaimed(*gend) and all(is_unclaimed(mi, mj) for mi, mj in mids):
            return False
    return True


def build_subfractals(initial_gaps, start_scale, min_scale, required, lattice,
                       segments, geo, drift_rate, i_odds, j_odds, rng):
    def k(i, j):
        return (i, j)

    visited = set()
    current_gaps = list(initial_gaps)
    cell_scale = start_scale

    while cell_scale >= min_scale and current_gaps:
        for i in range(len(current_gaps) - 1, 0, -1):
            j = rng.rand_range(i + 1)
            current_gaps[i], current_gaps[j] = current_gaps[j], current_gaps[i]

        next_gaps = []
        for gap in current_gaps:
            gpoint, angle, step_i, step_j, seed_scale = gap
            vk = (k(*gpoint), cell_scale)
            if vk in visited:
                continue
            visited.add(vk)

            claimed = False
            if seed_scale is not None and cell_scale > seed_scale:
                claimed = False
            elif frontier_blocked(gpoint, cell_scale, required, lattice, step_i, step_j):
                claimed = False
            else:
                before = len(segments)
                sub_gaps = []
                build_lattice(gpoint, angle, cell_scale, required, lattice,
                               step_i, step_j, segments, sub_gaps,
                               geo, drift_rate, i_odds, j_odds, rng)
                claimed = len(segments) > before
                if claimed:
                    next_gaps.extend(sub_gaps)
            if not claimed:
                next_gaps.append(gap)

        current_gaps = next_gaps
        cell_scale = cell_scale // 2

    return segments


def generate_topology(drift, i_odds, j_odds, seed, size, bounds):
    """bounds is (min_x, min_y, max_x, max_y) in the same coordinate space as
    the fractal origin (which is placed at the center of `size`x`size`); the
    fractal grows outward until it fully covers these bounds instead of
    stopping at the nominal `size` square, so corners of an off-center clip
    region (e.g. extra spine margin) are still filled in."""
    rng = SeededRNG(seed)

    def k(i, j):
        return (i, j)

    origin = (size / 2, size / 2)
    base_length = size / 6
    initial_angle = 0

    drift_rate = drift * math.pi / 180
    drift_scale = base_length * 2

    e1 = (math.cos(initial_angle + math.pi / 4), math.sin(initial_angle + math.pi / 4))
    e2 = (math.cos(initial_angle - math.pi / 4), math.sin(initial_angle - math.pi / 4))
    unit_len = base_length / ROOT_CELL_SCALE

    geo = (origin, e1, e2, unit_len, drift_scale)

    min_x, min_y, max_x, max_y = bounds
    corners = [(min_x, min_y), (max_x, min_y), (min_x, max_y), (max_x, max_y)]
    max_r = max(math.hypot(cx - origin[0], cy - origin[1]) for cx, cy in corners)
    max_ij = math.ceil(max_r / unit_len) + 2

    lattice = {}

    def level_points(si, sj, level):
        return [(si * a, sj * (level - a)) for a in range(level + 1)]

    def visible(gi, gj):
        px, py = lattice_to_pixel(gi, gj, geo, drift_rate)
        return min_x <= px <= max_x and min_y <= py <= max_y

    quadrants = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    segments = []

    for step_i, step_j in quadrants:
        max_level = 0
        for level in range(2 * max_ij, -1, -1):
            if any(visible(i, j) for i, j in level_points(step_i, step_j, level)):
                max_level = level
                break

        required = set()
        for level in range(max_level + 2):
            for i, j in level_points(step_i, step_j, level):
                required.add(k(i, j))

        for key in list(required):
            i, j = key
            if i == 0 or j == 0:
                lattice.pop(key, None)

        root_gaps = []
        build_lattice((0, 0), initial_angle, ROOT_CELL_SCALE, required, lattice,
                      step_i, step_j, segments, root_gaps,
                      geo, drift_rate, i_odds, j_odds, rng)

        build_subfractals(root_gaps, ROOT_CELL_SCALE // 2, 1, required, lattice,
                          segments, geo, drift_rate, i_odds, j_odds, rng)

    # Axis lines
    for fixed_axis in (0, 1):
        for m in range(-max_ij, max_ij):
            if fixed_axis == 0:
                ai, aj, bi, bj = 0, m, 0, m + 1
            else:
                ai, aj, bi, bj = m, 0, m + 1, 0
            segments.append((ai, aj, bi, bj, 0))

    return segments, geo, max_ij


def ring_hole_centers(page_h_mm, hole_gaps_mm, hole_offset_mm):
    """Vertically centered hole centers, `hole_offset_mm` from the spine (left) edge.
    `hole_gaps_mm` gives the center-to-center spacing between consecutive holes,
    so len(hole_gaps_mm) + 1 holes are placed."""
    page_h_px = page_h_mm * DPI / MM_PER_INCH
    offset_px = hole_offset_mm * DPI / MM_PER_INCH
    gaps_px = [g * DPI / MM_PER_INCH for g in hole_gaps_mm]
    total_span = sum(gaps_px)
    first_y = (page_h_px - total_span) / 2
    ys = [first_y]
    for g in gaps_px:
        ys.append(ys[-1] + g)
    return [(offset_px, y) for y in ys]


def render_svg(segments, geo, drift_rate, canvas_size_px, page_w_mm, page_h_mm,
               stroke_color, stroke_width, stroke_opacity, background,
               margin_in, spine_margin_in, hole_gaps_mm, hole_diameter_mm,
               hole_offset_mm, center_dot_diameter_pt):
    page_w_px = page_w_mm * DPI / MM_PER_INCH
    page_h_px = page_h_mm * DPI / MM_PER_INCH
    margin_px = margin_in * DPI
    spine_extra_px = spine_margin_in * DPI
    clip_x = margin_px + spine_extra_px

    # Center the fractal's origin on the visible (clipped) region, matching main().
    offset_x = (clip_x + (page_w_px - margin_px) - canvas_size_px) / 2
    offset_y = (margin_px + (page_h_px - margin_px) - canvas_size_px) / 2

    holes = ring_hole_centers(page_h_mm, hole_gaps_mm, hole_offset_mm)
    hole_radius_px = (hole_diameter_mm / 2) * DPI / MM_PER_INCH

    lines = []
    lines.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{page_w_mm}mm" height="{page_h_mm}mm" '
        f'viewBox="0 0 {page_w_px:.3f} {page_h_px:.3f}">'
    )
    lines.append('<defs>')
    lines.append(
        f'<clipPath id="page-margin"><rect x="{clip_x:.3f}" y="{margin_px:.3f}" '
        f'width="{page_w_px - margin_px - clip_x:.3f}" height="{page_h_px - 2 * margin_px:.3f}"/></clipPath>'
    )
    lines.append('</defs>')
    if background:
        lines.append(f'<rect x="0" y="0" width="{page_w_px:.3f}" height="{page_h_px:.3f}" fill="{background}"/>')

    lines.append('<g clip-path="url(#page-margin)">')
    lines.append(f'<g transform="translate({offset_x:.3f},{offset_y:.3f})">')
    lines.append(
        f'<g fill="none" stroke="{stroke_color}" stroke-width="{stroke_width}" '
        f'stroke-opacity="{stroke_opacity}" stroke-linecap="round">'
    )
    for ai, aj, bi, bj, scale in segments:
        ax, ay = lattice_to_pixel(ai, aj, geo, drift_rate)
        bx, by = lattice_to_pixel(bi, bj, geo, drift_rate)
        lines.append(f'<line x1="{ax:.3f}" y1="{ay:.3f}" x2="{bx:.3f}" y2="{by:.3f}"/>')
    lines.append('</g>')

    if center_dot_diameter_pt > 0:
        center_x, center_y = geo[0]
        center_radius_px = (center_dot_diameter_pt / 72) * DPI / 2
        lines.append(f'<circle cx="{center_x:.3f}" cy="{center_y:.3f}" r="{center_radius_px:.3f}" fill="{stroke_color}"/>')

    lines.append('</g>')
    lines.append('</g>')

    if holes:
        lines.append(
            f'<g fill="none" stroke="{stroke_color}" stroke-width="{stroke_width}">'
        )
        for cx, cy in holes:
            lines.append(f'<circle cx="{cx:.3f}" cy="{cy:.3f}" r="{hole_radius_px:.3f}"/>')
        lines.append('</g>')

    lines.append('</svg>')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Generate the bleed tab fractal as an SVG, centered on an A6 page."
    )
    parser.add_argument('-o', '--output', default='bleed-tab-fractal.svg',
                         help='Output SVG file path (default: bleed-tab-fractal.svg)')
    parser.add_argument('--seed', type=int, default=None,
                         help='RNG seed. Default: a random seed is chosen each run '
                              '(and printed, so a specific result can be reproduced with '
                              '--seed later)')
    parser.add_argument('--drift', type=float, default=45.0,
                         help='Swirl drift angle in degrees, -180 to 180 (default: 45)')
    parser.add_argument('--i-odds', type=float, default=0.2,
                         help='Branch probability along the I axis, 0-1 (default: 0.2)')
    parser.add_argument('--j-odds', type=float, default=0.2,
                         help='Branch probability along the J axis, 0-1 (default: 0.2)')
    parser.add_argument('--size', type=float, default=400.0,
                         help='Fractal canvas size in px before scaling to the page (default: 400)')
    parser.add_argument('--fractal-size-mm', type=float, default=None,
                         help='If set, scale the fractal so its bounding canvas is this many mm '
                              'across; overrides --size for physical output (default: fits A6 '
                              'with 10mm margin)')
    parser.add_argument('--page-width-mm', type=float, default=A6_WIDTH_MM,
                         help=f'Page width in mm (default: {A6_WIDTH_MM}, A6 organizer size)')
    parser.add_argument('--page-height-mm', type=float, default=A6_HEIGHT_MM,
                         help=f'Page height in mm (default: {A6_HEIGHT_MM}, A6 organizer size)')
    parser.add_argument('--stroke-color', default='#000000',
                         help='Stroke color (default: #000000)')
    parser.add_argument('--stroke-width', type=float, default=0.5,
                         help='Stroke width in px (default: 0.5)')
    parser.add_argument('--stroke-opacity', type=float, default=1.0,
                         help='Stroke opacity 0-1 (default: 1.0)')
    parser.add_argument('--background', default='none',
                         help='Page background color, or "none" for transparent (default: none)')
    parser.add_argument('--margin-in', type=float, default=0.25,
                         help='Margin from the page edge in inches; lines are clipped to stay '
                              'within it (default: 0.25)')
    parser.add_argument('--spine-margin-in', type=float, default=0.25,
                         help='Extra margin added on the spine side (left edge of the page), '
                              'on top of --margin-in (default: 0.25)')
    parser.add_argument('--hole-gaps-mm', default='19,19,51,19,19',
                         help='Comma-separated center-to-center gaps between consecutive ring '
                              'holes, in mm; N gaps produce N+1 holes. Empty string disables '
                              'holes (default: 19,19,51,19,19, standard 6-ring Personal/A6-organizer '
                              'spacing for a 173mm-tall page; true ISO A6 148mm pages use '
                              '19,19,38,19,19 instead)')
    parser.add_argument('--hole-diameter-mm', type=float, default=1.5,
                         help='Ring hole diameter in mm (default: 1.5; typical binder holes are '
                              '5-6mm, but a smaller marker is drawn here to leave clearance)')
    parser.add_argument('--hole-offset-mm', type=float, default=8.0,
                         help='Distance from the spine (left) edge to hole centers, in mm '
                              '(default: 8.0, standard A6/Filofax Pocket)')
    parser.add_argument('--center-dot-diameter-pt', type=float, default=2.0,
                         help='Diameter in points of the filled dot marking the fractal\'s '
                              'center, 0 to disable (default: 2.0)')
    args = parser.parse_args()

    seed = args.seed if args.seed is not None else random.SystemRandom().randrange(2**31)

    hole_gaps_mm = [float(g) for g in args.hole_gaps_mm.split(',') if g.strip()] \
        if args.hole_gaps_mm.strip() else []

    canvas_size_px = args.size
    if args.fractal_size_mm is not None:
        canvas_size_px = args.fractal_size_mm * DPI / MM_PER_INCH

    if not (0.0 <= args.i_odds <= 1.0):
        parser.error('--i-odds must be between 0 and 1')
    if not (0.0 <= args.j_odds <= 1.0):
        parser.error('--j-odds must be between 0 and 1')

    page_w_px = args.page_width_mm * DPI / MM_PER_INCH
    page_h_px = args.page_height_mm * DPI / MM_PER_INCH
    margin_px = args.margin_in * DPI
    spine_extra_px = args.spine_margin_in * DPI

    clip_x0 = margin_px + spine_extra_px
    clip_y0 = margin_px
    clip_x1 = page_w_px - margin_px
    clip_y1 = page_h_px - margin_px
    # Center the fractal's origin on the visible (clipped) region, not the full page,
    # so the spine-side margin doesn't shift the pattern off-center within that region.
    offset_x = (clip_x0 + clip_x1 - canvas_size_px) / 2
    offset_y = (clip_y0 + clip_y1 - canvas_size_px) / 2
    # Translate clip bounds into the fractal's local (pre-offset) coordinate space.
    bounds = (clip_x0 - offset_x, clip_y0 - offset_y, clip_x1 - offset_x, clip_y1 - offset_y)

    segments, geo, _max_ij = generate_topology(
        args.drift, args.i_odds, args.j_odds, seed, canvas_size_px, bounds
    )
    drift_rate = args.drift * math.pi / 180

    svg = render_svg(
        segments, geo, drift_rate, canvas_size_px,
        args.page_width_mm, args.page_height_mm,
        args.stroke_color, args.stroke_width, args.stroke_opacity,
        None if args.background == 'none' else args.background,
        args.margin_in, args.spine_margin_in,
        hole_gaps_mm, args.hole_diameter_mm, args.hole_offset_mm,
        args.center_dot_diameter_pt,
    )

    with open(args.output, 'w') as f:
        f.write(svg)

    print(f'Wrote {args.output} ({len(segments)} segments, '
          f'{args.page_width_mm}x{args.page_height_mm}mm page, seed={seed})',
          file=sys.stderr)


if __name__ == '__main__':
    main()
