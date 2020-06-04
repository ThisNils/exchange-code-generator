/* eslint-disable camelcase */
/* eslint-disable object-curly-newline */
/* eslint-disable prefer-template */
/* eslint-disable arrow-body-style */
/* eslint-disable no-empty */
/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle */
const puppeteer = require('puppeteer-core');
const { readdir } = require('fs').promises;
const { join } = require('path');

(async () => {
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

  const { code } = await useDeviceAuth(deviceAuthCredentials);
  console.log(`Your exchange code is: ${code}`);
  return code;
})();
