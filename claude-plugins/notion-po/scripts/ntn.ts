#!/usr/bin/env bun
// notion-po 스킬들이 공통으로 쓰는 ntn CLI 래퍼.
// 셸 heredoc 한글 깨짐, 첫 페이지만 읽는 조회, stdin 대기(hang), 고정 /tmp 경로를 여기서 한 번에 막는다.
//
// 사용법:
//   bun ntn.ts query-all <data_source_id> [--filter <json>]   전 페이지 조회 → results 배열(JSON)
//   bun ntn.ts sprints                                        스프린트 목록 한 줄씩: id | 이름 | start~end
//   bun ntn.ts backlog [--sprint <page_id>] [--unscored]      백로그 한 줄씩: id | 상태 | 이름 | 작업자 | pt | 점수
//   bun ntn.ts current-sprints                                이번/지난 스프린트 판정(JSON)
//   bun ntn.ts sprint-dates <N> [--today YYYY-MM-DD]          다음 스프린트 기간 계산(JSON)
//   bun ntn.ts write <api_path> <METHOD> <body.json> [--dry-run]
//   bun ntn.ts batch <ops.json> [--dry-run]                   [{label, path, method, body}] 순차 실행
//   bun ntn.ts md2blocks <brief.md> [--after <block_id>]      브리핑 마크다운 → {"children": blocks[, "after"]}

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPRINT_DS = "3a3f68d9-4082-807e-8a43-000b9965f503";
const BACKLOG_DS = "a07f68d9-4082-8359-9579-07c5578db49e";

// Notion API 의 페이지 크기 최댓값. ntn 기본값은 25 라 그대로 두면 26번째부터 안 보인다.
const PAGE_SIZE = 100;
// 백로그 수백 건 기준 한 장에 수 초. 60초를 넘기면 네트워크·인증 문제로 보고 끊는다.
const CALL_TIMEOUT_MS = 60_000;
// 100건 × 50장 = 5,000건. 이보다 많으면 커서 루프가 돌고 있다고 보고 멈춘다.
const MAX_PAGES = 50;
const SCORE_KEYS = ["작업크기", "비즈니스가치", "긴급도", "위험도"] as const;

type Json = any;

function die(msg: string): never {
  console.error(`ntn.ts: ${msg}`);
  process.exit(1);
}

function runNtn(args: string[]): { ok: boolean; out: string; err: string } {
  if (!Bun.which("ntn")) die("ntn CLI 가 없어요. 설치 후 `ntn login` 하세요.");
  const p = Bun.spawnSync(["ntn", ...args], {
    stdin: "ignore", // 비대화 환경에서 ntn 이 stdin 바디를 기다리며 멈추는 것을 막는다
    stdout: "pipe",
    stderr: "pipe",
    timeout: CALL_TIMEOUT_MS,
  });
  return { ok: p.exitCode === 0, out: p.stdout.toString(), err: p.stderr.toString() };
}

function parseFlags(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[a.slice(2)] = next; i++; }
    else flags[a.slice(2)] = true;
  }
  return { pos, flags };
}

function queryAll(ds: string, filter?: string): Json[] {
  const results: Json[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = ["datasources", "query", ds, "--limit", String(PAGE_SIZE), "--json"];
    if (filter) args.push("--filter", filter);
    if (cursor) args.push("--start-cursor", cursor);
    const r = runNtn(args);
    if (!r.ok) die(`조회 실패(${ds}): ${(r.err || r.out).slice(0, 300)}`);
    const d = JSON.parse(r.out);
    results.push(...(d.results ?? []));
    if (!d.has_more || !d.next_cursor) return results;
    cursor = d.next_cursor;
  }
  die(`${MAX_PAGES}장을 넘었어요. 필터를 좁히세요.`);
}

const text = (prop: Json) => (prop?.title ?? prop?.rich_text ?? []).map((x: Json) => x.plain_text).join("");
const sel = (prop: Json) => prop?.select?.name ?? "";

function sprintRows() {
  return queryAll(SPRINT_DS).map((p) => {
    const d = p.properties?.["기간"]?.date ?? {};
    return { id: p.id, name: text(p.properties?.["이름"]), start: d.start ?? "", end: d.end ?? "", url: p.url };
  });
}

function backlogRows(sprint?: string) {
  const filter = sprint
    ? JSON.stringify({ property: "⚡ 스프린트", relation: { contains: sprint } })
    : undefined;
  return queryAll(BACKLOG_DS, filter).map((p) => {
    const pr = p.properties ?? {};
    return {
      id: p.id,
      status: pr["상태"]?.status?.name ?? "",
      name: text(pr["작업 이름"]),
      people: (pr["작업자"]?.people ?? []).map((u: Json) => ({ id: u.id, name: u.name ?? "?" })),
      sprint: (pr["⚡ 스프린트"]?.relation ?? []).map((r: Json) => r.id),
      sp: pr["스토리포인트"]?.formula?.number ?? null,
      scores: Object.fromEntries(SCORE_KEYS.map((k) => [k, sel(pr[k])])),
      url: p.url,
    };
  });
}

function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sprintDates(n: number, today = new Date()) {
  if (!Number.isInteger(n) || n < 1 || n > 4) die("N 은 1~4 정수여야 해요.");
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const mondayOffset = (8 - base.getDay()) % 7; // getDay: 일=0, 월=1. 오늘이 월요일이면 0
  const start = new Date(base); start.setDate(base.getDate() + mondayOffset);
  const end = new Date(start); end.setDate(start.getDate() + n * 7 - 1); // 월~일, 양끝 포함 N*7일
  const s = localDate(start), e = localDate(end);
  return { start: s, end: e, title: `[${s.slice(2).replaceAll("-", "")}-${e.slice(2).replaceAll("-", "")}]스프린트` };
}

function write(path: string, method: string, body: Json, dryRun: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "notion-po-"));
  const file = join(dir, "body.json");
  try {
    writeFileSync(file, JSON.stringify(body), "utf8");
    const args = ["api", path, "-X", method.toUpperCase(), "-d", `@${file}`];
    if (dryRun) return { object: "dry-run", command: ["ntn", ...args].join(" "), body };
    const r = runNtn(args);
    if (!r.ok || !r.out.trim()) return { object: "error", code: "cli", message: (r.err || r.out).slice(0, 300) };
    try { return JSON.parse(r.out); }
    catch { return { object: "error", code: "parse", message: r.out.slice(0, 300) }; }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function md2blocks(md: string) {
  const rt = (s: string) =>
    s.split("**").flatMap((seg, i) =>
      seg ? [{ type: "text", text: { content: seg }, annotations: { bold: i % 2 === 1 } }] : []);
  const TYPES: [string, string][] = [["### ", "heading_3"], ["## ", "heading_2"], ["- ", "bulleted_list_item"], ["> ", "quote"]];
  const blocks: Json[] = [];
  for (const line of md.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    if (s === "---") { blocks.push({ type: "divider", divider: {} }); continue; }
    const hit = TYPES.find(([p]) => s.startsWith(p));
    const [prefix, typ] = hit ?? ["", "paragraph"];
    blocks.push({ type: typ, [typ]: { rich_text: rt(s.slice(prefix.length)) } });
  }
  // blocks children append 는 한 번에 100개까지만 받는다
  if (blocks.length > 100) die(`블록 ${blocks.length}개 — 100개 제한을 넘어요. 브리핑 분량을 줄이세요.`);
  return { children: blocks };
}

const readJson = (f: string) => {
  try { return JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { die(`${f} 를 JSON 으로 읽지 못했어요: ${(e as Error).message}`); }
};
const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

const [cmd, ...rest] = Bun.argv.slice(2);
const { pos, flags } = parseFlags(rest);
const dryRun = flags["dry-run"] === true;

switch (cmd) {
  case "query-all": {
    if (!pos[0]) die("query-all <data_source_id> [--filter <json>]");
    out(queryAll(pos[0], typeof flags.filter === "string" ? flags.filter : undefined));
    break;
  }
  case "sprints": {
    for (const r of sprintRows().sort((a, b) => a.start.localeCompare(b.start)))
      console.log(`${r.id} | ${r.name || "(제목 없음)"} | ${r.start || "-"} ~ ${r.end || "-"}`);
    break;
  }
  case "backlog": {
    const sprint = typeof flags.sprint === "string" ? flags.sprint : undefined;
    let rows = backlogRows(sprint);
    if (flags.unscored) rows = rows.filter((r) => SCORE_KEYS.some((k) => !r.scores[k]));
    if (flags.json) { out(rows); break; }
    for (const r of rows) {
      const people = r.people.map((u: Json) => u.name).join(", ") || "-";
      const missing = SCORE_KEYS.filter((k) => !r.scores[k]);
      const score = missing.length ? `빈 점수: ${missing.join(",")}` : SCORE_KEYS.map((k) => `${k}=${r.scores[k]}`).join(" ");
      console.log(`${r.id} | [${r.status}] ${r.name} | 작업자: ${people} | ${r.sp ?? "-"}pt | ${score}`);
    }
    break;
  }
  case "current-sprints": {
    // 기간이 월~월로 겹치는 옛 스프린트가 있어 경계일엔 오늘이 둘에 걸린다.
    // 이번 = 오늘을 포함하는 것 중 시작일이 가장 늦은 것, 지난 = 이번보다 먼저 시작한 것 중 종료일이 가장 늦은 것.
    const today = localDate(new Date());
    const rows = sprintRows().filter((r) => r.start && r.end);
    const cur = rows.filter((r) => r.start <= today && today <= r.end).sort((a, b) => b.start.localeCompare(a.start))[0] ?? null;
    const last = cur ? rows.filter((r) => r.start < cur.start).sort((a, b) => b.end.localeCompare(a.end))[0] ?? null : null;
    out({ today, current: cur, last, untitled: sprintRows().filter((r) => !r.start).map((r) => r.id) });
    break;
  }
  case "sprint-dates": {
    // --today 는 경계 날짜 검증용
    const today = typeof flags.today === "string" ? new Date(`${flags.today}T00:00:00`) : new Date();
    out(sprintDates(Number(pos[0]), today));
    break;
  }
  case "write": {
    const [path, method, file] = pos;
    if (!path || !method || !file) die("write <api_path> <METHOD> <body.json> [--dry-run]");
    const res = write(path, method, readJson(file), dryRun);
    out(res);
    if (res.object === "error") process.exit(1);
    break;
  }
  case "batch": {
    if (!pos[0]) die("batch <ops.json> [--dry-run]");
    const ops = readJson(pos[0]);
    if (!Array.isArray(ops)) die("ops.json 은 [{label, path, method, body}] 배열이어야 해요.");
    const failed: Json[] = [];
    for (const op of ops) {
      const res = write(op.path, op.method, op.body, dryRun);
      const ok = res.object !== "error";
      console.log(`${ok ? "OK  " : "FAIL"} ${op.label ?? op.path}${ok ? (res.url ? ` ${res.url}` : "") : ` — ${res.code}: ${res.message}`}`);
      if (dryRun) console.log(`     ${res.command}`);
      if (!ok) failed.push({ label: op.label, code: res.code, message: res.message });
    }
    console.log(`\n${ops.length - failed.length}/${ops.length} 성공`);
    if (failed.length) { out({ failed }); process.exit(1); }
    break;
  }
  case "md2blocks": {
    if (!pos[0]) die("md2blocks <brief.md> [--after <block_id>]");
    const body: Json = md2blocks(readFileSync(pos[0], "utf8"));
    if (typeof flags.after === "string") body.after = flags.after; // 이 블록 뒤에 삽입
    out(body);
    break;
  }
  default:
    die("명령: query-all | sprints | backlog | current-sprints | sprint-dates | write | batch | md2blocks");
}
