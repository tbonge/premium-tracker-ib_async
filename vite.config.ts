import { spawn } from 'child_process';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    plugins: [{
      name: 'ib-gateway-loader',
      configureServer(server) {
        const runPython = (args: string[], res: any) => {
          const scriptPath = path.resolve(__dirname, 'scripts', 'load_ib_gateway.py');
          const pythonCommand = env.IB_PYTHON || process.env.IB_PYTHON || 'python';
          const child = spawn(pythonCommand, args, {
            cwd: __dirname,
            env: process.env
          });

          let stdout = '';
          let stderr = '';
          let responded = false;

          const sendJson = (statusCode: number, body: unknown) => {
            if (responded) return;
            responded = true;
            res.statusCode = statusCode;
            res.setHeader('Content-Type', 'application/json');
            res.end(typeof body === 'string' ? body : JSON.stringify(body));
          };

          child.stdout.on('data', chunk => {
            stdout += chunk.toString();
          });

          child.stderr.on('data', chunk => {
            stderr += chunk.toString();
          });

          child.on('error', error => {
            sendJson(500, { error: `Failed to start Python: ${error.message}` });
          });

          child.on('close', code => {
            if (code !== 0) {
              sendJson(500, {
                error: stderr.trim() || `IB Gateway loader exited with code ${code}.`
              });
              return;
            }

            sendJson(200, stdout);
          });
        };

        server.middlewares.use('/api/ib/live', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          const scriptPath = path.resolve(__dirname, 'scripts', 'load_ib_gateway.py');
          runPython([
            scriptPath,
            '--host', env.IB_GATEWAY_HOST || process.env.IB_GATEWAY_HOST || '127.0.0.1',
            '--port', env.IB_GATEWAY_PORT || process.env.IB_GATEWAY_PORT || '4001',
            '--client-id', env.IB_CLIENT_ID || process.env.IB_CLIENT_ID || '77',
            '--readonly',
            '--flex-token', env.IB_FLEX_TOKEN || process.env.IB_FLEX_TOKEN || '',
            '--flex-query-id', env.IB_FLEX_QUERY_ID || process.env.IB_FLEX_QUERY_ID || ''
          ], res);
        });

        server.middlewares.use('/api/ib/current', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          const scriptPath = path.resolve(__dirname, 'scripts', 'load_ib_gateway.py');
          runPython([
            scriptPath,
            '--host', env.IB_GATEWAY_HOST || process.env.IB_GATEWAY_HOST || '127.0.0.1',
            '--port', env.IB_GATEWAY_PORT || process.env.IB_GATEWAY_PORT || '4001',
            '--client-id', env.IB_CLIENT_ID || process.env.IB_CLIENT_ID || '77',
            '--readonly'
          ], res);
        });

        server.middlewares.use('/api/ib/flex', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          const flexToken = env.IB_FLEX_TOKEN || process.env.IB_FLEX_TOKEN || '';
          const flexQueryId = env.IB_FLEX_QUERY_ID || process.env.IB_FLEX_QUERY_ID || '';
          if (!flexToken || !flexQueryId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Set both IB_FLEX_TOKEN and IB_FLEX_QUERY_ID before starting Vite.' }));
            return;
          }

          const scriptPath = path.resolve(__dirname, 'scripts', 'load_ib_gateway.py');
          runPython([
            scriptPath,
            '--flex-only',
            '--flex-token', flexToken,
            '--flex-query-id', flexQueryId
          ], res);
        });

        server.middlewares.use('/api/ib/underlying-prices', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          req.on('end', () => {
            const scriptPath = path.resolve(__dirname, 'scripts', 'load_ib_gateway.py');
            runPython([
              scriptPath,
              '--host', env.IB_GATEWAY_HOST || process.env.IB_GATEWAY_HOST || '127.0.0.1',
              '--port', env.IB_GATEWAY_PORT || process.env.IB_GATEWAY_PORT || '4001',
              '--client-id', env.IB_CLIENT_ID || process.env.IB_CLIENT_ID || '77',
              '--readonly',
              '--prices-only',
              '--symbols-json', body || '[]'
            ], res);
          });
        });
      }
    }]
  };
});
