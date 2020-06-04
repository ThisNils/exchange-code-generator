/* eslint-disable camelcase */
/* eslint-disable object-curly-newline */
/* eslint-disable prefer-template */
/* eslint-disable arrow-body-style */
/* eslint-disable no-empty */
/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle */
const puppeteer = require('puppeteer-core');
const { post, get } = require('request-promise');
const { createInterface } = require('readline');
const { readdir, mkdir, writeFile, readFile } = require('fs').promises;
const { join } = require('path');

const makeBool = (text) => text.toLowerCase() === 'y' || text.toLowerCase() === 'yes' || !text;

const consoleQuestion = (question, isYN = false) => {
  return new Promise((res) => {
    const itf = createInterface(process.stdin, process.stdout);
    itf.question(isYN ? `${question}(yes/no) ` : question, (answer) => {
      res(isYN ? makeBool(answer) : answer);
      itf.close();
    });
  });
};
const wait = (time) => new Promise((res) => setTimeout(res, time));

const useDeviceAuth = async (deviceAuth) => {
  const { access_token } = await post({
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'basic MzQ0NmNkNzI2OTRjNGE0NDg1ZDgxYjc3YWRiYjIxNDE6OTIwOWQ0YTVlMjVhNDU3ZmI5YjA3NDg5ZDMxM2I0MWE=',
    },
    form: {
      grant_type: 'device_auth',
      account_id: deviceAuth.accountId,
      device_id: deviceAuth.deviceId,
      secret: deviceAuth.secret,
    },
    json: true,
  });
  return get({
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange',
    headers: {
      Authorization: `bearer ${access_token}`,
    },
    json: true,
  });
};

const generateDeviceAuth = async (exchangeCode) => {
  const iosToken = await post({
    url: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'basic MzQ0NmNkNzI2OTRjNGE0NDg1ZDgxYjc3YWRiYjIxNDE6OTIwOWQ0YTVlMjVhNDU3ZmI5YjA3NDg5ZDMxM2I0MWE=',
    },
    form: {
      grant_type: 'exchange_code',
      exchange_code: exchangeCode,
      includePerms: false,
    },
    json: true,
  });
  return post({
    url: `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${iosToken.account_id}/deviceAuth`,
    headers: {
      Authorization: `bearer ${iosToken.access_token}`,
    },
    json: true,
  });
};

(async () => {
  const savingFolder = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share');
  const userFolders = await readdir(savingFolder);
  if (!userFolders.find((f) => f === 'ecg')) await mkdir(join(savingFolder, 'ecg'));
  const savedFiles = await readdir(join(savingFolder, 'ecg'));
  if (savedFiles.find((sv) => sv === 'deviceauth')) {
    if (await consoleQuestion('Found a saved profile! Do you want to use it? ', true)) {
      const deviceAuthCredentials = JSON.parse(await readFile(join(savingFolder, 'ecg') + '/deviceauth'));
      const { code } = await useDeviceAuth(deviceAuthCredentials);
      console.log(`Your exchange code is: ${code}`);
      console.log('This terminal will be closed in 15 seconds');
      await wait(15000);
      return;
    }
  }
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

  const oldXsrfToken = (await page.cookies()).find((c) => c.name === 'XSRF-TOKEN').value;
  page.once('request', (req) => {
    req.continue({
      method: 'GET',
      headers: {
        ...req.headers,
        'X-XSRF-TOKEN': oldXsrfToken,
      },
    });
  });
  await page.setRequestInterception(true);
  await page.goto('https://www.epicgames.com/id/api/authenticate');
  await page.setRequestInterception(false);

  page.once('request', (req) => {
    req.continue({
      method: 'GET',
      headers: {
        ...req.headers,
        'X-XSRF-TOKEN': oldXsrfToken,
      },
    });
  });
  await page.setRequestInterception(true);
  try {
    await page.goto('https://www.epicgames.com/id/api/csrf');
  } catch (e) {}
  await page.setRequestInterception(false);

  const xsrfToken = (await page.cookies()).find((c) => c.name === 'XSRF-TOKEN').value;
  page.once('request', (req) => {
    req.continue({
      method: 'POST',
      headers: {
        ...req.headers,
        'X-XSRF-TOKEN': xsrfToken,
      },
    });
  });
  await page.setRequestInterception(true);
  const pageJSON = await (await page.goto('https://www.epicgames.com/id/api/exchange/generate')).json();
  await browser.close();

  const deviceAuthCredentials = await generateDeviceAuth(pageJSON.code);
  await writeFile(join(savingFolder, 'ecg') + '/deviceauth', JSON.stringify(deviceAuthCredentials));

  const { code } = await useDeviceAuth(deviceAuthCredentials);
  console.log(`Your exchange code is: ${code}`);
  console.log('This terminal will be closed in 15 seconds');
  await wait(15000);
})();
