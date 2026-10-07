/** Display-only ink and paper; native coordinates and printable SVG stay intact. */
export function dwgDisplaySvg(svg: string, theme: "dark" | "light", thumbnail = false): string {
  const paper = theme === "dark" ? "#212830" : "#fffdf7";
  const ink = theme === "dark" ? "#d8e1e8" : "#111827";
  return svg.replace("</style>", `
    svg > rect{fill:${paper}}
    .dwg{stroke:${ink}}
    .dwg-text{fill:${ink}}
    ${thumbnail ? ".dwg path{vector-effect:non-scaling-stroke;stroke-width:1}" : ""}
  </style>`);
}
