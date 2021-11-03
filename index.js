/* eslint-disable no-console */
const axios = require('axios').default;
const { createInterface, emitKeypressEvents } = require('readline');
const {
  readdir, mkdir, writeFile, readFile,
} = require('fs').promises;
const { join } = require('path');
const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const { exec } = require('child_process');

puppeteer.use(stealthPlugin());

delete axios.defaults.headers.post['Content-Type'];

const makeBool = (text) => text.toLowerCase() === 'y' || text.toLowerCase() === 'yes' || !text;

const consoleQuestion = (question, isYN = false) => new Promise((res) => {
  const itf = createInterface(process.stdin, process.stdout);
  itf.question(isYN ? `${question}(yes/no) ` : question, (answer) => {
    res(isYN ? makeBool(answer) : answer);
    itf.close();
  });
});

const makeForm = (keyValuePairs) => {
  const data = new URLSearchParams();
  Object.keys(keyValuePairs).forEach((key) => data.append(key, keyValuePairs[key]));
  return data.toString();
};

const copyToClipboard = (text) => {
  switch (process.platform) {
    case 'darwin': exec(`echo '${text}' | pbcopy`); break;
    case 'linux': exec(`echo ${text} | xclip -sel c`); break;
    case 'win32': exec(`echo | set /p ecgvar="${text}" | clip`); break;
    default: console.log('your OS is not supported');
  }
};

const useDeviceAuth = async (deviceAuth) => {
  const { data: { access_token: accessToken } } = await axios({
    method: 'POST',
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'basic MzQ0NmNkNzI2OTRjNGE0NDg1ZDgxYjc3YWRiYjIxNDE6OTIwOWQ0YTVlMjVhNDU3ZmI5YjA3NDg5ZDMxM2I0MWE=',
    },
    data: makeForm({
      grant_type: 'device_auth',
      account_id: deviceAuth.accountId,
      device_id: deviceAuth.deviceId,
      secret: deviceAuth.secret,
    }),
  });
  return (await axios({
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange',
    headers: {
      Authorization: `bearer ${accessToken}`,
    },
  })).data;
};

const generateDeviceAuth = async (exchangeCode) => {
  const { data: { access_token: accessToken, account_id: accountId, displayName } } = await axios({
    method: 'POST',
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'basic MzQ0NmNkNzI2OTRjNGE0NDg1ZDgxYjc3YWRiYjIxNDE6OTIwOWQ0YTVlMjVhNDU3ZmI5YjA3NDg5ZDMxM2I0MWE=',
    },
    data: makeForm({
      grant_type: 'exchange_code',
      exchange_code: exchangeCode,
      token_type: 'eg1',
    }),
  });

  const { data: { deviceId, secret } } = await axios({
    method: 'POST',
    url: `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${accountId}/deviceAuth`,
    headers: {
      Authorization: `bearer ${accessToken}`,
    },
  });
  return {
    accountId, deviceId, secret, displayName,
  };
};

const getExchangeCode = async (savingFolder) => {
  console.log('Checking for Chrome installation');
  let chromeIsAvailable = true;
  try {
    if (process.platform !== 'win32') throw new Error();
    const chromePath = await readdir(`${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application`);
    if (!chromePath.find((f) => f === 'chrome.exe')) throw new Error();
  } catch (e) {
    chromeIsAvailable = false;
  }

  let executablePath;
  if (chromeIsAvailable) {
    executablePath = `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`;
    console.log('Chrome is already installed');
  } else {
    const browserFetcher = puppeteer.createBrowserFetcher({
      path: join(savingFolder, 'ecg'),
    });
    console.log(await browserFetcher.canDownload('666595') ? 'Downloading Chrome. This may take a while!' : 'Chrome is already installed');
    const downloadInfo = await browserFetcher.download('666595');
    executablePath = downloadInfo.executablePath;
  }
  console.log('Starting chrome...');
  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    devtools: false,
    defaultViewport: {
      width: 500, height: 800,
    },
    args: ['--window-size=500,800', '--lang=en-US'],
  });

  console.log('Chrome started! Please log in');

  const page = await browser.pages().then((p) => p[0]);
  await page.goto('https://epicgames.com/id');
  await (await page.waitForSelector('#login-with-epic')).click();
  await page.waitForRequest((req) => req.url() === 'https://www.epicgames.com/account/personal' && req.method() === 'GET', {
    timeout: 120000000,
  });

  const oldXSRF = (await page.cookies()).find((c) => c.name === 'XSRF-TOKEN').value;
  let newXSRF;

  page.on('request', (req) => {
    if (['https://www.epicgames.com/id/api/authenticate', 'https://www.epicgames.com/id/api/csrf'].includes(req.url())) {
      req.continue({
        method: 'GET',
        headers: {
          ...req.headers,
          'X-XSRF-TOKEN': oldXSRF,
        },
      });
    } else if (req.url() === 'https://www.epicgames.com/id/api/exchange/generate') {
      req.continue({
        method: 'POST',
        headers: {
          ...req.headers,
          'X-XSRF-TOKEN': newXSRF,
        },
      });
    } else {
      req.continue();
    }
  });

  await page.setRequestInterception(true);

  await page.goto('https://www.epicgames.com/id/api/authenticate');

  try {
    await page.goto('https://www.epicgames.com/id/api/csrf');
  } catch (e) { /* ignore */ }

  newXSRF = (await page.cookies()).find((c) => c.name === 'XSRF-TOKEN').value;

  const pageJSON = await (await page.goto('https://www.epicgames.com/id/api/exchange/generate')).json();
  await browser.close();

  return pageJSON.code;
};

(async () => {
  const savingFolder = process.env.APPDATA || (process.platform === 'darwin' ? `${process.env.HOME}/Library/Preferences` : `${process.env.HOME}/.local/share`);
  const userFolders = await readdir(savingFolder);
  if (!userFolders.find((f) => f === 'ecg')) await mkdir(join(savingFolder, 'ecg'));

  let deviceAuth;
  try {
    deviceAuth = JSON.parse(await readFile(join(savingFolder, 'ecg', 'deviceauth')));
  } catch (e) { /* ignore */ }
  if (!deviceAuth || !await consoleQuestion(`Found a saved profile${deviceAuth.displayName ? ` (${deviceAuth.displayName})` : ''}! Do you want to use it? `, true)) {
    const exchangeCode = await getExchangeCode(savingFolder);

    console.log('Saving login credentials');
    deviceAuth = await generateDeviceAuth(exchangeCode);
    await writeFile(join(savingFolder, 'ecg', 'deviceauth'), JSON.stringify(deviceAuth));
  }

  delete deviceAuth.displayName;

  console.log('Generating exchange code');
  const { code: exchangeCode } = await useDeviceAuth(deviceAuth);
  console.log(`\nYour exchange code is: ${exchangeCode}\nYour device auth is: ${JSON.stringify(deviceAuth)}\n`);
  console.log('Press E to copy the exchange code to your clipboard\nPress A to copy the device auth to your clipboard\n');
  const itf = createInterface(process.stdin, process.stdout);
  emitKeypressEvents(process.stdin, itf);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    process.stdout.cursorTo(0);
    process.stdout.write('\r\x1b[K');
    if (key.name.toLowerCase() === 'e') {
      copyToClipboard(exchangeCode);
      process.stdout.write('The exchange code was copied to your clipboard');
    } else if (key.name.toLowerCase() === 'a') {
      copyToClipboard(JSON.stringify(deviceAuth));
      process.stdout.write('The device auth was copied to your clipboard');
    }
  });

  process.stdin.resume();
})();
