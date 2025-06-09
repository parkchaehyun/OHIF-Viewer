// eval.mts
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import deepEqual from 'fast-deep-equal';

// llmService 모듈 로드
const llmModule = await import('./llmService.ts');
const sendPromptToLLM =
  typeof llmModule.sendPromptToLLM === 'function' ? llmModule.sendPromptToLLM :
    typeof llmModule.default === 'function' ? llmModule.default :
      llmModule.default?.sendPromptToLLM;

if (typeof sendPromptToLLM !== 'function') {
  throw new Error('sendPromptToLLM 함수를 찾을 수 없습니다');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// result 폴더 및 summary 폴더 경로
const resultDir = path.join(__dirname, 'result');
const summaryDir = path.join(resultDir, 'summary');

// 타입 정의
type EvalItem = { id: number; function: number; category: string; instruction: string; expected: any; };
type ResultItem = { id: number; function: number; category: string; instruction: string; expected: any; actual: any; pass: boolean; duration: number; };
type Stats = { [funcNum: number]: { name: string; total: number; correct: number; durations: number[] } };

// context 감지
function detectContext(exp: any): 'viewer' | 'worklist' {
  const v = new Set([
    'change_layout', 'rotate_view', 'zoom_view', 'pan_view',
    'play_cine', 'stop_cine', 'download_image', 'reset_view',
    'define_macro', 'perform_macro'
  ]);
  return v.has(exp.command) ? 'viewer' : 'worklist';
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function evaluateLLM(filePath: string) {
  const data: EvalItem[] = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  const stats: Stats = {};
  const logs: string[] = [];
  const results: ResultItem[] = [];

  const studiesPath = path.join(__dirname, 'studies.json');
  const studies = JSON.parse(await fs.readFile(studiesPath, 'utf-8'));

  const resultsPath = path.join(resultDir, 'results.json');
  const logPath = path.join(resultDir, 'log.txt');

  // 초기화: 이전 결과 파일 삭제 및 새로 시작
  await fs.writeFile(resultsPath, '[\n');
  await fs.writeFile(logPath, '');

  for (let i = 0; i < data.length; i++) {
    const it = data[i];
    const start = Date.now();
    const actual = await sendPromptToLLM(it.instruction, detectContext(it.expected), studies);
    const duration = Date.now() - start;
    const pass = deepEqual(actual, it.expected);

    // stats 업데이트
    if (!stats[it.function]) {
      stats[it.function] = { name: it.category, total: 0, correct: 0, durations: [] };
    }
    stats[it.function].total++;
    if (pass) stats[it.function].correct++;
    stats[it.function].durations.push(duration);

    // 로그 라인
    const logLines: string[] = [];
    logLines.push(`${pass ? '✅' : '❌'} [${it.category}] ${it.instruction} (${duration}ms)`);
    if (!pass) {
      logLines.push(`  Expected: ${JSON.stringify(it.expected)}`);
      logLines.push(`  Actual:   ${JSON.stringify(actual)}`);
    }

    // 메모리와 디스크에 동시 저장
    logs.push(...logLines);
    await fs.appendFile(logPath, logLines.join('\n') + '\n');

    // 결과 저장
    const resultItem: ResultItem = { ...it, actual, pass, duration };
    results.push(resultItem);
    const isLast = i === data.length - 1;
    const resultLine = JSON.stringify(resultItem, null, 2) + (isLast ? '\n' : ',\n');
    await fs.appendFile(resultsPath, resultLine);

    await sleep(6000);
  }

  // JSON 배열 닫기
  await fs.appendFile(resultsPath, ']\n');

  // summary 작성
  const summary: Record<string, { name: string; total: number; correct: number; accuracy: number; avgTime: number; }> = {};
  for (const func in stats) {
    const s = stats[func];
    const acc = s.correct / s.total * 100;
    const avg = s.durations.reduce((a, b) => a + b, 0) / s.durations.length;
    summary[func] = {
      name: s.name,
      total: s.total,
      correct: s.correct,
      accuracy: Math.round(acc * 10) / 10,
      avgTime: Math.round(avg)
    };
  }

  await fs.writeFile(
    path.join(summaryDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  return results;
}


// 실행
const dataPath = path.join(__dirname, 'data.json');
await evaluateLLM(dataPath);
