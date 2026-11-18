// Speaks backend/rag_worker.py's stdio protocol, for testing RagWorker without Python.
//
//   node fake-rag-worker.js [normal|fatal|crash-on-start]
//
// Questions trigger behaviors: "crash" exits, "silent" never answers, "bad" returns
// bad_request, "wait:<ms>" answers after a delay; anything else is echoed back.
import readline from 'node:readline';

const mode = process.argv[2] ?? 'normal';
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const BOOKS = [{ book_id: 'holt_1894', title: 'The Care and Feeding of Children', author: 'L. Emmett Holt', year: 1894, chunks: 232 }];

if (mode === 'fatal') {
  send({ event: 'fatal', message: 'ModuleNotFoundError: No module named chromadb' });
  process.exit(1);
}
if (mode === 'crash-on-start') process.exit(2);

console.error('loading models...'); // stderr is logged, never parsed
setTimeout(() => send({ event: 'ready', pid: process.pid, books: BOOKS, chunks: 232 }), Number(process.env.FAKE_STARTUP_MS ?? 0));

readline
  .createInterface({ input: process.stdin })
  .on('line', (line) => {
    const { id, op, params = {} } = JSON.parse(line);
    if (op === 'books') return send({ id, ok: true, result: BOOKS });
    const question = params.question ?? '';
    if (question === 'crash') process.exit(3);
    if (question === 'silent') return;
    if (question === 'bad') return send({ id, ok: false, error: { code: 'bad_request', message: 'bad question' } });
    const delay = question.startsWith('wait:') ? Number(question.slice(5)) : 0;
    setTimeout(() => send({ id, ok: true, result: { status: 'answered', answer: `echo: ${question}`, pid: process.pid } }), delay);
  })
  .on('close', () => process.exit(0));
