## canvas
- viewBox: 0 0 1280 720
- format: PPT 16:9

## mode
- mode: briefing

## visual_style
- visual_style: soft-rounded

## colors
- bg: #FFFFFF
- bg_secondary: #F8FAFC
- primary: #4F46E5
- primary_tint: #EEF2FF
- primary_border: #C7D2FE
- accent: #06B6D4
- accent_tint: #ECFEFF
- accent_border: #A5F3FC
- success: #10B981
- success_tint: #ECFDF5
- success_border: #A7F3D0
- warning: #EF4444
- warning_border: #FECACA
- text: #1E293B
- text_secondary: #64748B
- text_tertiary: #94A3B8
- border: #E2E8F0

## typography
- font_family: "Microsoft YaHei", "PingFang SC", sans-serif
- code_family: Consolas, "Courier New", monospace
- body: 22
- cover_title: 66
- section: 44
- title: 36
- subtitle: 29
- annotation: 16
- footnote: 13

## icons
- library: tabler-outline
- stroke_width: 2
- inventory: movie, sparkles, writing, layout-grid, photo, video, microphone, users, circle-check, timeline, file-export, code, database, cloud, bolt, stack, components, server, robot, message, refresh, info-circle, file-text, list-check, rocket, clock, check

## page_rhythm
- P01: anchor
- P02: dense
- P03: breathing
- P04: dense
- P05: dense
- P06: dense
- P07: dense
- P08: dense
- P09: dense
- P10: breathing
- P11: anchor

## page_charts
- P04: icon_grid
- P06: layered_architecture
- P07: pipeline_with_stages
- P08: process_flow
- P09: labeled_card

## forbidden
- Mixing icon libraries
- rgba()
- `<style>`, `class`, `<foreignObject>`, `textPath`, `@font-face`, `<animate*>`, `<script>`, `<iframe>`, `<symbol>`+`<use>`
- `<g opacity>` (set opacity on each child element individually)
- HTML named entities in text (`&nbsp;`, `&mdash;`, `&copy;` …) — write as raw Unicode; XML reserved chars `& < > " '` must be escaped as `&amp; &lt; &gt; &quot; &apos;`
