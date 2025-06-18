// eval.mts
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import deepEqual from 'fast-deep-equal';

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

const args = process.argv.slice(2);
const includeIdx = args.indexOf('--include');
const shotIdx = args.indexOf('--shot');

const includedFunctions = includeIdx !== -1 ? args.slice(includeIdx + 1).map(Number) : null;
const selectedShot = shotIdx !== -1 ? args[shotIdx + 1] : 'fewshot_with_cot';

// 경로
const resultDir = path.join(__dirname, 'result');

// 타입 정의
type EvalItem = { id: number; function: number; category: string; instruction: string; expected: any; };
type ResultItem = { id: number; function: number; category: string; instruction: string; expected: any; actual: any; pass: boolean; duration: number; };
type Stats = { [funcNum: number]: { name: string; total: number; correct: number; durations: number[] } };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function evaluateLLM(filePath: string) {
  const data: EvalItem[] = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  const filteredData = includedFunctions ? data.filter(d => includedFunctions.includes(d.function)) : data;

  const stats: Stats = {};
  const logs: string[] = [];
  const results: ResultItem[] = [];

  const studiesPath = path.join(__dirname, 'studies.json');
  const studies = JSON.parse(await fs.readFile(studiesPath, 'utf-8'));

  const resultsPath = path.join(resultDir, 'results.json');
  const logPath = path.join(resultDir, 'log.txt');

  await fs.writeFile(resultsPath, '[\n');
  await fs.writeFile(logPath, '');

  for (let i = 0; i < filteredData.length; i++) {
    const it = filteredData[i];

    // ⬇️ 선택된 few-shot 방식 전달
    const start = Date.now();
    const actual = await sendPromptToLLM(it.instruction, "worklist", studies, selectedShot);
    const duration = Date.now() - start;
    const pass = deepEqual(actual, it.expected);

    if (!stats[it.function]) {
      stats[it.function] = { name: it.category, total: 0, correct: 0, durations: [] };
    }
    stats[it.function].total++;
    if (pass) stats[it.function].correct++;
    stats[it.function].durations.push(duration);

    const logLines = [`${pass ? '✅' : '❌'} [${it.category}] ${it.instruction} (${duration}ms)`];
    if (!pass) {
      logLines.push(`  Expected: ${JSON.stringify(it.expected)}`);
      logLines.push(`  Actual:   ${JSON.stringify(actual)}`);
    }
    logs.push(...logLines);
    await fs.appendFile(logPath, logLines.join('\n') + '\n');

    const resultItem: ResultItem = { ...it, actual, pass, duration };
    results.push(resultItem);
    const isLast = i === filteredData.length - 1;
    const resultLine = JSON.stringify(resultItem, null, 2) + (isLast ? '\n' : ',\n');
    await fs.appendFile(resultsPath, resultLine);

    await sleep(4100);
  }

  await fs.appendFile(resultsPath, ']\n');

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
    path.join(resultDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  return results;
}

// 실행
const dataPath = path.join(__dirname, 'data.json');
await evaluateLLM(dataPath);
