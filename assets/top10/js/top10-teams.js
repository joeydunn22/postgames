/* ============================================================
   TOP 10 — TEAM COLORS
   One standout color per team code in the data, by sport. These are
   the teams' real colors; teamColor() lightens any that are too dark
   to read on the page's background. Codes with no color here (e.g.
   "2TM", a player traded mid-season) show in the plain muted style.
   ============================================================ */

const TEAM_COLORS = {
    mlb: {
        ANA: "#BA0021", ATH: "#003831", ATL: "#CE1141", AZ: "#A71930", BAL: "#DF4601",
        BOS: "#BD3039", CAL: "#BA0021", CHC: "#0E3386", CIN: "#C6011F", CLE: "#E50022",
        COL: "#33006F", CWS: "#C4CED4", DET: "#FA4616", FLA: "#00A3AD", HOU: "#EB6E1F",
        KC: "#004687", LA: "#005A9C", LAA: "#BA0021", LAD: "#005A9C", MIA: "#00A3E0",
        MIL: "#FFC52F", MIN: "#D31145", MON: "#003087", NYM: "#FF5910", NYY: "#003087",
        OAK: "#003831", PHI: "#E81828", PIT: "#FDB827", SD: "#FFC425", SEA: "#005C5C",
        SF: "#FD5A1E", STL: "#C41E3A", TB: "#8FBCE6", TEX: "#003278", TOR: "#134A8E",
        WSH: "#AB0003",
        // Older codes, for all-time boards
        BRO: "#005A9C", BSN: "#CE1141", NYG: "#FD5A1E", PHA: "#003831", SLB: "#DF4601",
        WAS: "#AB0003"
    },
    nfl: {
        ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D", CAR: "#0085CA",
        CHI: "#C83803", CIN: "#FB4F14", CLE: "#FF3C00", DAL: "#003594", DEN: "#FB4F14",
        DET: "#0076B6", GB: "#FFB612", HOU: "#A71930", IND: "#002C5F", JAX: "#006778",
        KC: "#E31837", LA: "#003594", LAC: "#0080C6", LV: "#A5ACAF", MIA: "#008E97",
        MIN: "#4F2683", NE: "#C60C30", NO: "#D3BC8D", NYG: "#0B2265", NYJ: "#125740",
        OAK: "#A5ACAF", RAI: "#A5ACAF", PHI: "#004C54", PIT: "#FFB612", SD: "#0080C6", SEA: "#69BE28",
        SF: "#AA0000", STL: "#B3995D", TB: "#D50A0A", TEN: "#4B92DB", WAS: "#FFB612"
    },
    nba: {
        ATL: "#E03A3E", BKN: "#FFFFFF", BOS: "#007A33", CHA: "#00788C", CHH: "#00778B",
        CHI: "#CE1141", CLE: "#FDBB30", DAL: "#00538C", DEN: "#FEC524", DET: "#C8102E",
        GSW: "#FFC72C", HOU: "#CE1141", IND: "#FDBB30", KCK: "#E03A3E", LAC: "#C8102E",
        LAL: "#FDB927", MEM: "#5D76A9", MIA: "#98002E", MIL: "#00471B", MIN: "#78BE20",
        NJN: "#CD1041", NOH: "#00778B", NOK: "#00778B", NOP: "#B4975A", NYK: "#F58426",
        OKC: "#007AC1", ORL: "#0077C0", PHI: "#006BB6", PHX: "#E56020", POR: "#E03A3E",
        SAC: "#5A2D81", SAS: "#C4CED4", SDC: "#00A3E0", SEA: "#00653A", TOR: "#CE1141",
        UTA: "#F9A01B", VAN: "#00B2A9", WAS: "#E31837",
        // Older codes, for all-time boards
        CIN: "#5A2D81", SFW: "#FFC72C", STL: "#E03A3E"
    }
};

// Page background (--bg) and the contrast team colors need on it
const TEAM_COLOR_BACKGROUND = [11, 13, 18];
const TEAM_COLOR_MIN_CONTRAST = 5;
const _readableTeamColors = {};

// A team's color, brightened just enough to read on the background
// (keeping its hue and intensity, so navy turns a vivid blue rather
// than grey); null if the code has no color
function teamColor(sport, team) {
    const hex = TEAM_COLORS[sport]?.[team];
    if (!hex) return null;
    if (!_readableTeamColors[hex]) {
        const [h, s, l] = rgbToHsl([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
        let lightness = l;
        while (lightness < 0.95 && contrastRatio(hslToRgb(h, s, lightness), TEAM_COLOR_BACKGROUND) < TEAM_COLOR_MIN_CONTRAST) {
            lightness += 0.02;
        }
        _readableTeamColors[hex] = `rgb(${hslToRgb(h, s, lightness).join(", ")})`;
    }
    return _readableTeamColors[hex];
}

function contrastRatio(a, b) {
    const luminance = rgb => {
        const [r, g, bl] = rgb.map(c => {
            const v = c / 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl([r, g, b]) {
    [r, g, b] = [r / 255, g / 255, b / 255];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = t => {
        t = (t + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [h + 1 / 3, h, h - 1 / 3].map(t => Math.round(channel(t) * 255));
}
