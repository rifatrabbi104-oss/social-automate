const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();

const HOST = 'ssh-ranonex.alwaysdata.net';
const USER = 'ranonex';
const PASSWORD = process.env.ALWAYSDATA_PASSWORD || 'rifat123R@';
const REMOTE_DIR = '/home/ranonex/www';

console.log(`🔌 Connecting to ${USER}@${HOST}...`);

conn.on('ready', () => {
  console.log('✅ SSH Connection established!');

  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP Error:', err.message);
      conn.end();
      return;
    }

    const localServerJs = path.join(__dirname, 'server.js');
    const localPackageJson = path.join(__dirname, 'package.json');
    const localEnv = path.join(__dirname, '.env');

    const remoteServerJs = `${REMOTE_DIR}/server.js`;
    const remotePackageJson = `${REMOTE_DIR}/package.json`;
    const remoteEnv = `${REMOTE_DIR}/.env`;

    console.log(`📤 Uploading server.js to ${remoteServerJs}...`);
    sftp.fastPut(localServerJs, remoteServerJs, (err1) => {
      if (err1) {
        console.error('Failed to upload server.js:', err1.message);
        conn.end();
        return;
      }
      console.log('✅ server.js uploaded successfully!');

      console.log(`📤 Uploading package.json to ${remotePackageJson}...`);
      sftp.fastPut(localPackageJson, remotePackageJson, (err2) => {
        if (err2) {
          console.error('Failed to upload package.json:', err2.message);
          conn.end();
          return;
        }
        console.log('✅ package.json uploaded successfully!');

        console.log(`📤 Uploading .env to ${remoteEnv}...`);
        sftp.fastPut(localEnv, remoteEnv, (err3) => {
          if (err3) {
            console.error('Failed to upload .env:', err3.message);
          } else {
            console.log('✅ .env uploaded successfully!');
          }

          const localTester = path.join(__dirname, 'gemini-live-tester.html');
          const remoteTester = `${REMOTE_DIR}/gemini-live-tester.html`;
          const localDashboard = path.join(__dirname, 'dashboard.html');
          const remoteDashboard = `${REMOTE_DIR}/dashboard.html`;

          sftp.fastPut(localTester, remoteTester, (errT) => {
            if (!errT) console.log('✅ gemini-live-tester.html uploaded successfully!');

            sftp.fastPut(localDashboard, remoteDashboard, (errD) => {
              if (!errD) console.log('✅ dashboard.html uploaded successfully!');

              // Restart the Alwaysdata node service by triggering system-restart API
              console.log('🔄 Restarting Alwaysdata Node.js process...');
              fetch('https://ranonex.alwaysdata.net/api/system-restart').catch(() => {});
              setTimeout(() => {
                console.log('✅ Deployment complete! Server is restarting.');
                conn.end();
                process.exit(0);
              }, 2500);
            });
          });
        });
      });
    });
  });
}).on('error', (err) => {
  console.error('❌ SSH Connection Error:', err.message);
}).connect({
  host: HOST,
  port: 22,
  username: USER,
  password: PASSWORD,
  readyTimeout: 35000
});
