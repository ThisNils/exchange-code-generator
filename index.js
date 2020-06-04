/* eslint-disable prefer-template */
/* eslint-disable arrow-body-style */
/* eslint-disable no-empty */
/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle */
const puppeteer = require('puppeteer-core');
const { createInterface } = require('readline');
const { readdir } = require('fs').promises;

const consoleQuestion = (question) => {
  return new Promise((res) => {
    const itf = createInterface(process.stdin, process.stdout);
    itf.question(question, (answer) => {
      res(answer);
      itf.close();
    });
  });
};
const wait = (time) => new Promise((res) => setTimeout(res, time));

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
      path: `${process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share')}\\ecg`,
    });
    console.log(await browserFetcher.canDownload('666595') ? 'Downloading Chrome. This may take a while!' : 'Chrome is already installed');
    const downloadInfo = await browserFetcher.download('666595');
    executablePath = downloadInfo.executablePath;
  }
  const email = await consoleQuestion('Please enter your email: ');
  const password = await consoleQuestion('Please enter your password: ');
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

  console.log('Chrome started! Please do the captcha if needed');

  const page = await browser.pages().then((p) => p[0]);
  await page.goto('https://epicgames.com/id');
  await (await page.waitForSelector('#login-with-epic')).click();
  await (await page.waitForSelector('#email')).type(email, { delay: 3 });
  await (await page.waitForSelector('#password')).type(password, { delay: 3 });
  await (await page.waitForSelector('#login:not(:disabled)')).click();
  await page.waitForRequest((req) => req.url() === 'https://www.epicgames.com/account/personal' && req.method() === 'GET', {
    timeout: 120000,
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
  const { code } = await (await page.goto('https://www.epicgames.com/id/api/exchange/generate')).json();
  await browser.close();


  console.log(`Your exchange code is: ${code}`);
  console.log('This terminal will be closed in 15 seconds');
  await wait(15000);
})();
