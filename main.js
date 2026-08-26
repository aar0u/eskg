#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { chromium } from 'playwright';

const VERSION = ['v1.5.5.8', 1558];
const LOGO = `
Project Version: ${VERSION[0]}
Project Devs: rzc0d3r, AdityaGarg8, k0re,
              Fasjeit, alejanpa17, Ischunddu,
              soladify, AngryBonk, Xoncia,
              Anteneh13, otre4, AHDR3,
              Shariful797
`;

const DEFAULT_EMAIL_PROVIDER = 'emailfake';
const WEB_WRAPPER_EMAIL_PROVIDERS = ['guerrillamail', 'mailticking', 'fakemail', 'inboxes', 'incognitomail', 'emailfake'];

const DEFAULT_ARGS = { no_headless: false, email_provider: DEFAULT_EMAIL_PROVIDER };
const DEFAULT_MAX_ITER = 30;
const DEFAULT_DELAY_MS = 1000;
const EMAIL_POLL_DELAY_MS = 5000;
const LOG_PATH = path.resolve(process.cwd(), 'trial.log');

const LoggerType = {
  ERROR: {label: '[ FAILED ]', color: '\u001b[31m'},
  OK: {label: '[  OK  ]', color: '\u001b[32m'},
  INFO: {label: '[ INFO ]', color: '\u001b[90m'},
  WARN: {label: '[ WARN ]', color: '\u001b[33m'},
};

function colorize(text, color) {
  return `${color}${text}\u001b[0m`;
}

function appendLogLine(line, level = 'INFO') {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_PATH, `${timestamp} - ${level} - ${line}\n`, 'utf8');
}

function getSafeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeDumpToken(value = '') {
  return String(value).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 50);
}

function clearOldDumpFiles() {
  const dumpDir = path.resolve(process.cwd(), 'dumps');
  try {
    if (!fs.existsSync(dumpDir)) {
      return;
    }
    for (const entry of fs.readdirSync(dumpDir)) {
      if (entry.toLowerCase().endsWith('.html')) {
        fs.unlinkSync(path.join(dumpDir, entry));
      }
    }
  } catch {
    // ignore dump cleanup failures
  }
}

async function dumpHtmlSnapshot(page, iteration, email = '', reason = '', source = 'main') {
  const timestamp = getSafeTimestamp();
  const iterationValue = Number.isInteger(iteration) && iteration > 0 ? iteration : 0;
  const sourceToken = normalizeDumpToken(source || 'main').slice(0, 16);
  const emailToken = normalizeDumpToken(email || 'unknown-email');
  const reasonToken = reason ? normalizeDumpToken(reason).slice(0, 24) : 'unknown';

  const payload = {
    iteration: iterationValue,
    source: source || 'main',
    reason: reason || 'unknown',
    url: 'about:blank',
    title: 'unavailable',
    isClosed: true,
    html: '',
    capturedAt: new Date().toISOString(),
  };

  const filename = `eset-error-${iterationValue}-${timestamp}-${sourceToken}-${emailToken}-${reasonToken}.html`;
  const fallbackFilename = `eset-error-${iterationValue}-${timestamp}.html`;
  const dumpDirs = [
    path.resolve(process.cwd(), 'dumps'),
    process.cwd(),
    path.resolve(process.env.TEMP || process.env.TMP || process.cwd()),
  ];

  try {
    payload.isClosed = page && typeof page.isClosed === 'function'
      ? page.isClosed()
      : true;
    payload.url = page && typeof page.url === 'function'
      ? page.url()
      : 'about:blank';
    payload.title = (!payload.isClosed && page && typeof page.title === 'function')
      ? await page.title().catch(() => 'unavailable')
      : 'unavailable';
    payload.html = page && typeof page.content === 'function'
      ? await page.content().catch(() => '')
      : '';
    payload.capturedAt = new Date().toISOString();
  } catch {
    // keep fallback-friendly defaults
  }

  const content = `<!--\n  iteration: ${payload.iteration}\n  source: ${payload.source}\n  reason: ${payload.reason}\n  isClosed: ${payload.isClosed}\n  url: ${payload.url}\n  title: ${payload.title}\n  capturedAt: ${payload.capturedAt}\n-->\n${payload.html}`;

  for (const dir of dumpDirs) {
    try {
      const filepath = path.join(dir, filename);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filepath, content, 'utf8');
      return filepath;
    } catch {
      // try next location
    }
  }

  try {
    const filepath = path.join(process.cwd(), fallbackFilename);
    fs.writeFileSync(filepath, `<!--\n  iteration: ${payload.iteration}\n  source: ${payload.source}\n  reason: ${payload.reason}\n  url: ${payload.url}\n  capturedAt: ${payload.capturedAt}\n  fallback: true\n-->`, 'utf8');
    return filepath;
  } catch {
    return null;
  }
}

function consoleLog(text, type = LoggerType.INFO) {
  const marker = type.label;
  const color = type.color;
  if (text === '') {
    console.log('');
    return;
  }
  const msg = text.startsWith('\n') ? text : `${text}`;
  console.log(colorize(marker + ' ' + msg, color));
}

function parseArgv(rawArgv = process.argv.slice(2)) {
  if (rawArgv[0] === '--') {
    rawArgv = rawArgv.slice(1);
  }
  const args = { ...DEFAULT_ARGS };
  for (let i = 0; i < rawArgv.length; i += 1) {
    const token = rawArgv[i];
    if (token === '--no-headless') { args.no_headless = true; continue; }
    if (token === '--email-provider') {
      const provider = rawArgv[i + 1];
      if (!provider || provider.startsWith('--')) throw new Error('Missing value for --email-provider');
      args.email_provider = provider; i += 1; continue;
    }
    throw new Error('Unsupported argument: ' + token);
  }
  return args;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function promptLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function waitForCondition(fn, { delay = DEFAULT_DELAY_MS, maxIter = DEFAULT_MAX_ITER } = {}) {
  for (let i = 0; i < maxIter; i += 1) {
    try {
      if (await fn()) {
        return true;
      }
    } catch {
      // retry
    }
    await sleep(delay);
  }
  throw new Error('waitForCondition timeout');
}

function randomPassword(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function parseTokenFromText(messageText) {
  const tokenMatch = /token=([A-Za-z0-9:/-]+)/.exec(messageText);
  if (!tokenMatch) {
    return null;
  }
  const token = tokenMatch[1];
  if (token && token.length === 36) {
    return token;
  }
  return null;
}

async function parseToken(emailObj, page = null, { maxIter = DEFAULT_MAX_ITER, delay = DEFAULT_DELAY_MS } = {}) {
  const activePage = page || emailObj?.page || null;
  for (let attempt = 0; attempt < maxIter; attempt += 1) {
    let activationHref = null;
    if (emailObj.className === '1secmail') {
      const messages = await emailObj.readEmail();
      if (Array.isArray(messages)) {
        for (const message of messages) {
          const bodyMessage = await emailObj.getMessage(message.id);
          if ((bodyMessage.from || '').includes('product.eset.com')) activationHref = bodyMessage.body || '';
        }
      }
    } else if (emailObj.className === 'developermail' || emailObj.className === 'inboxes') {
      const messages = await emailObj.getMessages();
      if (Array.isArray(messages)) {
        for (const message of messages) {
          if ((message.from || '').includes('product.eset.com')) { activationHref = message.body || ''; break; }
        }
      }
    } else {
      const inbox = await emailObj.parseInbox();
      if (Array.isArray(inbox) && activePage) {
        for (const [mailId] of inbox) {
          await emailObj.openMail(mailId);
          if (['mailticking', 'incognitomail', 'emailfake'].includes(emailObj.className)) await sleep(1000);
          try {
            if (emailObj.className === 'mailticking') {
              const frame = activePage.frame({ name: 'email-iframe' });
              activationHref = frame ? await frame.getAttribute("xpath=//a[starts-with(@href, 'https://login.eset.com')]", 'href').catch(() => null) : null;
            } else {
              activationHref = await activePage.locator("xpath=//a[starts-with(@href, 'https://login.eset.com')]").first().getAttribute('href').catch(() => null);
            }
          } catch { activationHref = null; }
          if (activationHref) break;
        }
      }
    }
    const token = parseTokenFromText(activationHref || '');
    if (token) return token;
    await sleep(delay);
  }
  throw new Error('Token retrieval error, try again later or change the email provider.');
}
class OneSecEmailProvider {
  className = '1secmail';
  constructor() {
    this.email = null;
    this.login = null;
    this.domain = null;
    this.api = 'https://www.1secmail.com/api/v1/';
  }

  async init() {
    const res = await fetch(`${this.api}?action=genRandomMailbox&count=1`).catch((err) => { throw new Error(`SecEmailAPI: API access error! ${err.message}`); });
    if (!res.ok) throw new Error('SecEmailAPI: API access error!');
    const data = await res.json();
    const [address] = data;
    [this.login, this.domain] = String(address).split('@');
    this.email = `${this.login}@${this.domain}`;
  }

  async readEmail() {
    const res = await fetch(`${this.api}?action=getMessages&login=${this.login}&domain=${this.domain}`).catch((err) => {
      throw new Error(`SecEmailAPI: API access error! ${err.message}`);
    });
    if (!res.ok) throw new Error('SecEmailAPI: API access error!');
    return res.json();
  }

  async getMessage(messageId) {
    const res = await fetch(`${this.api}?action=readMessage&login=${this.login}&domain=${this.domain}&id=${messageId}`).catch((err) => {
      throw new Error(`SecEmailAPI: API access error! ${err.message}`);
    });
    if (!res.ok) throw new Error('SecEmailAPI: API access error!');
    return res.json();
  }
}

class DeveloperMailProvider {
  className = 'developermail';
  constructor() {
    this.email = null;
    this.email_name = '';
    this.headers = {};
    this.apiUrl = 'https://www.developermail.com/api/v1';
  }

  async init() {
    const res = await fetch(`${this.apiUrl}/mailbox`, { method: 'PUT' });
    if (!res.ok) throw new Error('DeveloperMailProvider: API access error!');
    const data = await res.json();
    const values = Object.values(data.result || {});
    this.email_name = values[0] || '';
    const token = values[1] || '';
    this.email = `${this.email_name}@developermail.com`;
    this.headers = { 'X-MailboxToken': token };
  }

  async getMessages() {
    const listRes = await fetch(`${this.apiUrl}/mailbox/${this.email_name}`, {
      headers: this.headers,
    });
    if (!listRes.ok) return null;
    const messageIds = (await listRes.json()).result || [];
    if (!messageIds.length) {
      return null;
    }

    const messages = [];
    for (const messageId of messageIds) {
      try {
        const msgRes = await fetch(`${this.apiUrl}/mailbox/${this.email_name}/messages/${messageId}`, {
          headers: this.headers,
        });
        const messageText = await msgRes.text();
        const subject = messageText.match(/^Subject:\s*(.+)$/m)?.[1] || '';
        const from = messageText.match(/^From:\s*(.+)$/m)?.[1] || '';
        const bodyMatch = messageText.split('\n\n').slice(1).join('\n\n');
        messages.push({ subject, from, body: bodyMatch });
      } catch {
        // ignore
      }
    }

    return messages.length ? messages : null;
  }
}

class WebWrapperEmailProvider {
  className = '';
  constructor(page) {
    this.page = page;
    this.email = null;
  }

  async parseInbox() {
    return [];
  }

  async openMail(_id) {
    // override
  }
}

const PARSE_GUERRILLAMAIL_INBOX = `(() => {
var email_list = document.getElementById('email_list')?.children || [];
var inbox = [];
for(var i=0; i < email_list.length-1; i++) {
  var mail = email_list[i].children;
  var from = mail[1]?.innerText;
  var subject = mail[2]?.innerText;
  var mail_id = mail[0]?.children[0]?.value;
  inbox.push([mail_id, from, subject]);
}
return inbox;
})()`;

const PARSE_MAILTICKING_INBOX = `(() => {
function MailTickingParse() {
  var inbox = [];
  var mlist = document.getElementById('message-list')?.children || [];
  for(i=0; i<mlist.length-1; i++) {
    var mfields = mlist[i].children;
    var mail_id = mfields[0]?.children[0]?.href || null;
    var from = mfields[0]?.innerText || '';
    var subject = mfields[1]?.innerText || '';
    if (!mail_id) {
      continue;
    }
    inbox.push([mail_id, from, subject]);
  }
  return inbox;
}
return MailTickingParse();
})()`;

const PARSE_FAKEMAIL_INBOX = `(() => {
let raw_inbox = Array.from(document.getElementById('schranka').children).slice(0, -3);
let inbox = [];
for(let i=0; i<raw_inbox.length; i++) {
  let id = raw_inbox[i].dataset.href;
  let from = raw_inbox[i].children[0].children[1].tagName.toLowerCase();
  let subject = raw_inbox[i].children[1].innerText.trim();
  inbox.push([id, from, subject]);
}
return inbox;
})()`;

const PARSE_INCOGNITOMAIL_INBOX = `(() => {
let li_elements = document.getElementsByTagName('li');
let messages_header = [];
for (let i = 0; i < li_elements.length; i++) {
    let headers = li_elements[i].querySelectorAll('p');
    try {
      if (headers[0].title != '' && headers[1].title != '')
        messages_header.push([headers[0], headers[0].title, headers[1].title]);
    } catch (error) { }
}
return messages_header;
})()`;

const PARSE_EMAILFAKE_INBOX = `(() => {
let inbox = [];
let table = document.getElementById('email-table');
if (!table || !table.children || table.children.length === 0) {
  return [];
}
let messages = table.children;
let first_message = messages[0];
if (!first_message || !first_message.children) {
  return [];
}
let first_childrens = first_message.children;
if (first_message.tagName === 'DIV') {
  if (first_childrens.length >= 2) {
    return [['https://emailfake.com', first_childrens[0].innerText, first_childrens[1].innerText]];
  }
  return [];
}
for (let i = 0; i < messages.length; i++) {
  let message = messages[i];
  let childrens = messages[i].children;
  if (!message || !childrens || childrens.length < 2) {
    continue;
  }
  inbox.push([message.href, childrens[0].innerText, childrens[1].innerText]);
}
return inbox;
})()`;

class GuerRillaMailProvider extends WebWrapperEmailProvider {
  className = 'guerrillamail';

  async init() {
    await this.page.goto('https://www.guerrillamail.com/');
    await waitForCondition(() => this.page.locator('#email-widget').count().then((c) => c > 0), { maxIter: 40 });
    const email = await this.page.locator('#email-widget').innerText();
    const domain = await this.page.evaluate(() => {
      const domainEl = document.getElementById('gm-host-select');
      const options = Array.from(domainEl?.options || []);
      if (options.length === 0) return '';
      return options[Math.floor(Math.random() * options.length)]?.value || '';
    });
    this.email = `${String(email).split('@')[0]}@${domain}`;
  }

  async parseInbox() {
    const raw = await this.page.evaluate(PARSE_GUERRILLAMAIL_INBOX);
    return Array.isArray(raw) ? raw : [];
  }

  async openMail(id) {
    await this.page.goto(`https://www.guerrillamail.com/inbox?mail_id=${id}`);
  }
}

class MailTickingProvider extends WebWrapperEmailProvider {
  className = 'mailticking';

  async init() {
    await this.page.goto('https://www.mailticking.com');
    await this.page.waitForTimeout(500);
    const activeBtn = this.page.locator('.modal-footer.text-center .activeBtn').first();
    await activeBtn.waitFor({ timeout: 10000 }).catch(() => null);
    await activeBtn.click({ timeout: 10000 }).catch(() => null);
    const activeMail = this.page.locator('#active-mail');
    await waitForCondition(() => activeMail.inputValue().then((value) => String(value || '').trim() !== ''), { maxIter: 20, delay: 500 });
    this.email = (await activeMail.inputValue()).trim();
    consoleLog(`[EMAIL] Current mailbox: ${this.email}`, LoggerType.INFO);
  }

  async parseInbox() {
    const currentMailbox = await this.page.locator('#active-mail').inputValue().catch(() => '');
    consoleLog(`[EMAIL] Current mailbox: ${String(currentMailbox || '').trim() || this.email || 'unknown'}`, LoggerType.INFO);
    const refreshButton = this.page.locator('#refresh-button');
    if (await refreshButton.count().catch(() => 0)) {
      await refreshButton.click({ timeout: 5000 }).catch(() => null);
      await this.page.waitForTimeout(1000);
    }
    const raw = await this.page.evaluate(PARSE_MAILTICKING_INBOX);
    return Array.isArray(raw) ? raw.filter((item) => Array.isArray(item) && typeof item[0] === 'string' && item[0] !== '') : [];
  }

  async openMail(id) {
    if (!id || typeof id !== 'string') {
      throw new Error('MailTickingProvider.openMail received invalid mail URL.');
    }
    await this.page.goto(id);
  }
}

class FakeMailProvider extends WebWrapperEmailProvider {
  className = 'fakemail';

  async init() {
    await this.page.goto('https://www.fakemail.net');
    await this.page.locator('#email').waitFor({ timeout: 15000 }).catch(() => null);
    this.email = (await this.page.locator('#email').innerText({ timeout: 10000 })).trim();
  }

  async parseInbox() {
    const raw = await this.page.evaluate(PARSE_FAKEMAIL_INBOX);
    return Array.isArray(raw) ? raw : [];
  }

  async openMail(id) {
    await this.page.goto(`https://www.fakemail.net/email/id/${id}`);
  }
}

class InboxesProvider extends WebWrapperEmailProvider {
  className = 'inboxes';

  async init() {
    await this.page.goto('https://inboxes.com');
    const button = this.page.getByRole('button', { name: /Get my first inbox!/i });
    await button.click({ timeout: 15000 }).catch(() => null);
    await this.page.waitForTimeout(800);
    const buttons = this.page.locator('button');
    const buttonCount = await buttons.count();
    for (let i = 0; i < buttonCount; i += 1) {
      const btn = buttons.nth(i);
      const text = (await btn.textContent())?.trim() || '';
      if (text.toLowerCase() === 'choose for me') {
        await btn.click();
        break;
      }
    }
    await this.page.waitForTimeout(1500);
    const emailCandidate = await this.page.evaluate(() => {
      const spans = Array.from(document.getElementsByTagName('span'));
      for (const span of spans) {
        const candidate = (span.textContent || '').replace(/\s+/g, '');
        if (/^[-a-z0-9+.]+@[a-z]+(\.[a-z]+)+$/.test(candidate)) {
          return candidate;
        }
      }
      return '';
    });
    this.email = emailCandidate || null;

    if (!this.email) {
      const response = await fetch(`https://inboxes.com/api/v2/inbox`);
      if (!response.ok) {
        throw new Error('Inboxes API error');
      }
    }
  }

  async getMessages() {
    if (!this.email) {
      return null;
    }
    const response = await fetch(`https://inboxes.com/api/v2/inbox/${this.email}`).then((r) => r.json()).catch(() => null);
    if (!response) {
      return null;
    }
    const rawInbox = response.msgs || [];
    const messages = [];
    for (const message of rawInbox) {
      const msgResponse = await fetch(`https://inboxes.com/api/v2/message/${message.uid}`).then((r) => r.json()).catch(() => null);
      if (!msgResponse) {
        continue;
      }
      messages.push({
        from: msgResponse.ff?.[0]?.address || '',
        subject: message.s || '',
        body: msgResponse.html || '',
      });
    }
    return messages.length ? messages : null;
  }

  parseInbox() {
    return this.getMessages().then((msgs) => msgs?.map((m) => [m.from, m.from, m.subject]) || []);
  }

  openMail() {
    // not used for API-backed path
  }
}

class IncognitoMailProvider extends WebWrapperEmailProvider {
  className = 'incognitomail';

  async init() {
    await this.page.goto('https://incognitomail.co/');
    await waitForCondition(() => this.page.locator('button[aria-label="Email dropdown"]').first().textContent().then((txt) => txt !== 'Creating...'), { maxIter: 25 });
    this.email = (await this.page.locator('button[aria-label="Email dropdown"]').first().innerText()).trim();
  }

  async parseInbox() {
    const raw = await this.page.evaluate(PARSE_INCOGNITOMAIL_INBOX);
    return Array.isArray(raw) ? raw : [];
  }

  async openMail(element) {
    if (element && typeof element.click === 'function') {
      await element.click();
    }
  }
}

class EmailFakeProvider extends WebWrapperEmailProvider {
  className = 'emailfake';
  openedMail = false;
  firstParse = true;
  refreshCount = 0;

  async init() {
    await this.page.goto('https://emailfake.com/fake_email_generator');
    await this.page.locator('#email_ch_text').waitFor({ timeout: 15000 });
    this.email = (await this.page.locator('#email_ch_text').innerText()).trim();
    consoleLog(`[EMAIL] Current mailbox: ${this.email}`, LoggerType.INFO);
    await this.page.goto('https://emailfake.com');
  }

  async parseInbox() {
    this.refreshCount += 1;
    if (this.openedMail || this.firstParse) {
      await this.page.goto('https://emailfake.com', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await this.page.locator('body').waitFor({ timeout: 5000 }).catch(() => null);
      this.openedMail = false;
      this.firstParse = false;
    }

    let inbox = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        inbox = await this.page.evaluate(PARSE_EMAILFAKE_INBOX);
        break;
      } catch (err) {
        if (!String(err?.message || err).includes('Execution context was destroyed')) {
          throw err;
        }
        await this.page.locator('body').waitFor({ timeout: 5000 }).catch(() => null);
      }
    }

    const currentMailbox = await this.page.locator('#email_ch_text').innerText().catch(() => '');
    const inboxList = Array.isArray(inbox) ? inbox : [];
    consoleLog(`[EMAIL] Inbox poll #${this.refreshCount}: mailbox=${String(currentMailbox || '').trim() || this.email || 'unknown'}, ${inboxList.length} message(s); next poll in ${EMAIL_POLL_DELAY_MS}ms`, LoggerType.INFO);
    return inboxList;
  }

  async openMail(url) {
    await this.page.goto(url);
    this.openedMail = true;
  }
}

const EMAIL_PROVIDERS = {
  '1secmail': () => new OneSecEmailProvider(),
  guerrillamail: (page) => new GuerRillaMailProvider(page),
  developermail: () => new DeveloperMailProvider(),
  mailticking: (page) => new MailTickingProvider(page),
  fakemail: (page) => new FakeMailProvider(page),
  inboxes: (page) => new InboxesProvider(page),
  incognitomail: (page) => new IncognitoMailProvider(page),
  emailfake: (page) => new EmailFakeProvider(page),
};

async function clickByDataLabel(page, tag, label, { index = 0, maxIter = DEFAULT_MAX_ITER } = {}) {
  const locator = page.locator(`${tag}[data-label="${label}"]`);
  for (let attempt = 0; attempt < maxIter; attempt += 1) {
    try {
      const target = locator.nth(index < 0 ? (await locator.count()) - 1 : index);
      await target.click({ timeout: 3000 });
      return true;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`${tag}[data-label="${label}"] click failed`);
}

async function clickButtonWithText(page, text) {
  const buttons = page.getByRole('button', { name: new RegExp(`^${text}$`, 'i') });
  for (let i = 0; i < DEFAULT_MAX_ITER; i += 1) {
    try {
      const count = await buttons.count();
      if (count > 0) {
        await buttons.first().click({ timeout: 2000 });
        return;
      }
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error(`${text} button error!`);
}

async function clickFirstAvailable(page, locatorFactories, description, { maxIter = DEFAULT_MAX_ITER } = {}) {
  for (let attempt = 0; attempt < maxIter; attempt += 1) {
    for (const createLocator of locatorFactories) {
      try {
        const locator = createLocator(page);
        const count = await locator.count();
        if (!count) {
          continue;
        }
        const target = locator.first();
        await target.waitFor({ state: 'visible', timeout: 1500 });
        await target.scrollIntoViewIfNeeded().catch(() => null);
        await target.click({ timeout: 2000 });
        return true;
      } catch {
        // try next locator
      }
    }
    await sleep(500);
  }
  throw new Error(`${description} click failed`);
}

async function dismissCommonErrorModal(page) {
  const modal = page.locator('[data-label="common-error-modal"]');
  if (!await modal.isVisible().catch(() => false)) {
    return false;
  }
  consoleLog('[ESET HOME] Detected error modal, retrying...', LoggerType.WARN);
  const button = page.locator('button[data-label="common-error-modal-dismiss-btn"], button[data-label="common-error-modal-closeBtn"]').first();
  const clicked = await button.click({ timeout: 500 }).then(() => true).catch(() => false);
  if (!clicked) {
    return false;
  }
  await modal.waitFor({ state: 'hidden', timeout: 500 }).catch(() => null);
  return true;
}

class EsetRegister {
  constructor(registeredEmailObj, esetPassword, page) {
    this.emailObj = registeredEmailObj;
    this.esetPassword = esetPassword;
    this.page = page;
  }

  async createAccount() {
    consoleLog('\n[EMAIL] Register page loading...', LoggerType.INFO);
    await this.page.goto('https://login.eset.com/Register');
    await waitForCondition(() => this.page.locator('#email').count().then((c) => c > 0), { maxIter: 35 });
    consoleLog('[EMAIL] Register page is loaded!', LoggerType.OK);

    const cookieBar = this.page.locator('#cookiebar');
    const cookieButton = this.page.locator('#cc-decline');
    if (await cookieBar.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
      const cookieClicked = await cookieButton.click({ timeout: 5000 }).then(() => true).catch(() => false);
      if (!cookieClicked) {
        throw new Error('Cookie consent button exists but could not be clicked.');
      }
      await cookieBar.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null);
      consoleLog('Cookies successfully bypassed!', LoggerType.OK);
      await sleep(500);
    }

    await this.page.locator('#email').fill(this.emailObj.email);
    const passwordIsMissing = await this.page.locator('#password').count().then((count) => count === 0);
    if (passwordIsMissing) {
      await clickByDataLabel(this.page, 'button', 'register-continue-button');
      await sleep(1000);
      const existsEmailError = await this.page.locator('.register-email-formGroup-validation, [data-label="register-email-formGroup-validation"]').count();
      if (existsEmailError) {
        throw new Error(`Email: ${this.emailObj.email} is already registered!`);
      }
    }

    await this.page.locator('#password').fill(this.esetPassword);

    const countryInput = this.page.locator('.select__single-value.css-1dimb5e-singleValue');
    if (await countryInput.count()) {
      const value = (await countryInput.first().innerText()).trim();
      if (value !== 'Ukraine') {
        const countrySelectInput = this.page.locator('#country-select-input');
        await countrySelectInput.click();
        await countrySelectInput.fill('Ukraine');
        await this.page.keyboard.press('Enter');
      }
    }

    await clickByDataLabel(this.page, 'button', 'register-create-account-button').catch(() => clickButtonWithText(this.page, 'Continue'));

    let unstableReads = 0;
    for (let i = 0; i < DEFAULT_MAX_ITER; i += 1) {
      if (this.page.isClosed()) {
        throw new Error('ESET registration page closed or became unavailable.');
      }

      const title = await this.page.title().catch(() => null);
      if (title === 'Service not available') {
        throw new Error('ESET service is not available.');
      }
      const currentUrl = this.page.url();
      if (currentUrl === 'https://home.eset.com/') {
        return true;
      }

      if (title === null) {
        unstableReads += 1;
        if (unstableReads >= 3) {
          throw new Error('ESET registration page temporarily unavailable.');
        }
      } else {
        unstableReads = 0;
      }

      await sleep(DEFAULT_DELAY_MS);
    }
    throw new Error('ESET registration did not complete in time.');
  }

  async confirmAccount() {
    const token = await parseToken(
      this.emailObj,
      WEB_WRAPPER_EMAIL_PROVIDERS.includes(this.emailObj.className) ? this.emailObj.page : null,
      { maxIter: 100, delay: EMAIL_POLL_DELAY_MS },
    );

    consoleLog(`ESET-HOME-Token: ${token}`, LoggerType.OK);
    consoleLog('\nAccount confirmation is in progress...', LoggerType.INFO);
    const confirmationUrl = `https://login.eset.com/link/confirmregistration?token=${token}`;
    await this.page.goto(confirmationUrl, { waitUntil: 'domcontentloaded' }).catch((err) => {
      if (!String(err?.message || err).includes('net::ERR_ABORTED')) {
        throw err;
      }
    });

    await waitForCondition(async () => {
      const title = await this.page.title().catch(() => '');
      const currentUrl = this.page.url();
      return title.includes('ESET HOME') || currentUrl.includes('home.eset.com');
    }).catch(() => {
      throw new Error('ESET-HOME token confirmation failed');
    });

    consoleLog('Account successfully confirmed!', LoggerType.OK);
    return true;
  }
}

class Trial {
  constructor(registeredEmailObj, page) {
    this.emailObj = registeredEmailObj;
    this.page = page;
  }

  async sendRequestForKey() {
    consoleLog('\n[ESET HOME] Request sending...', LoggerType.INFO);
    await clickFirstAvailable(this.page, [
      (page) => page.locator('button[data-label="onboarding-welcome-skip-introduction-btn"]'),
      (page) => page.getByRole('button', { name: /^Skip introduction$/i }),
    ], 'skip introduction');
    await clickFirstAvailable(this.page, [
      (page) => page.locator('label[data-label="onboarding-add-subscription-protect-card-trial"]'),
      (page) => page.getByText('Start a free 30-day trial', { exact: true }),
    ], 'trial option');
    await clickButtonWithText(this.page, 'continue');
    await clickFirstAvailable(this.page, [
      (page) => page.locator('label[data-label="onboarding-trial-protect-card-148"]'),
      (page) => page.getByText('Protect your home', { exact: true }),
    ], 'protect home option');
    await clickButtonWithText(this.page, 'continue');

    await waitForCondition(async () => {
      const loadingButton = this.page.getByRole('button', { name: /^Loading$/i });
      if (await loadingButton.count()) {
        return false;
      }
      const continueButton = this.page.getByRole('button', { name: /^Continue$/i });
      return await continueButton.count().then((c) => c > 0);
    }, { maxIter: 30, delay: 500 });
    await clickButtonWithText(this.page, 'continue');

    const clickMembersContinue = () => clickFirstAvailable(this.page, [
      (page) => page.locator('button[data-label="onboarding-members-continue-btn"]'),
      (page) => page.getByRole('button', { name: /^Continue$/i }),
    ], 'members continue');

    for (let step = 0; step < 8; step += 1) {
      const hasNameField = await this.page.locator('#name, input[name="name"]').count().then((c) => c > 0).catch(() => false);
      if (hasNameField) {
        await this.page.locator('#name, input[name="name"]').first().fill('John Bla');
        await clickMembersContinue();
        await sleep(500);
        await clickMembersContinue();
        await sleep(500);
        await clickFirstAvailable(this.page, [
          (page) => page.locator('label[data-label="onboarding-members-me-option"]'),
          (page) => page.getByText(/^Me$/i),
        ], 'members me option');
        await sleep(500);
        await clickButtonWithText(this.page, 'continue');
        await sleep(500);
        break;
      }

      const hasFinishForNow = await this.page.getByRole('button', { name: /^Finish for now$/i }).count().then((c) => c > 0).catch(() => false);
      const hasFinishProtectionModal = await this.page.getByRole('heading', { name: /^Finish setting up your protection$/i }).count().then((c) => c > 0).catch(() => false);
      if (hasFinishForNow || hasFinishProtectionModal) {
        break;
      }

      const hasContinue = await this.page.getByRole('button', { name: /^Continue$/i }).count().then((c) => c > 0).catch(() => false);
      if (!hasContinue) {
        await dismissCommonErrorModal(this.page).catch(() => false);
        await sleep(1000);
        continue;
      }
      await clickButtonWithText(this.page, 'continue').catch(async (err) => {
        if (!await dismissCommonErrorModal(this.page)) {
          throw err;
        }
      });
      await dismissCommonErrorModal(this.page).catch(() => false);
      await sleep(1000);
    }

    const finishButtons = [
      (page) => page.getByRole('button', { name: /^Finish for now$/i }),
      (page) => page.locator('button[data-label="onboarding-finish-protection-modal-finish-btn"]'),
      (page) => page.getByRole('button', { name: /^Continue to ESET HOME$/i }),
    ];
    let finished = false;
    for (let attempt = 0; attempt < 40 && !finished; attempt += 1) {
      if (await dismissCommonErrorModal(this.page)) {
        consoleLog('[ESET HOME] Error modal dismissed, retrying flow...', LoggerType.INFO);
        continue;
      }
      let clickedFinish = false;
      for (const createLocator of finishButtons) {
        const button = createLocator(this.page).first();
        if (!await button.isVisible().catch(() => false)) {
          continue;
        }
        if (await button.click({ timeout: 500 }).then(() => true).catch(() => false)) {
          clickedFinish = true;
          break;
        }
      }
      if (!clickedFinish) {
        await sleep(250);
        continue;
      }

      await sleep(1000);
      if (await dismissCommonErrorModal(this.page)) {
        consoleLog('[ESET HOME] Error modal dismissed, retrying flow...', LoggerType.INFO);
        continue;
      }
      finished = true;
    }
    if (!finished) {
      throw new Error('finish for now click failed');
    }
    consoleLog('[ESET HOME] Finish step succeeded.', LoggerType.OK);

    await clickFirstAvailable(this.page, [
      (page) => page.locator('button[data-label="common-side-menu-item-subscriptions"]'),
      (page) => page.getByRole('button', { name: /^Subscriptions$/i }),
    ], 'subscriptions');
    await clickFirstAvailable(this.page, [
      (page) => page.getByRole('button', { name: /^Open subscription$/i }),
      (page) => page.getByText('Open subscription', { exact: true }),
    ], 'open subscription');
    await waitForCondition(() => this.page.getByText(/Activation key/i).count().then((c) => c > 0), { maxIter: 20, delay: 500 });

    consoleLog('[ESET HOME] Request successfully sent!', LoggerType.OK);
  }

  async getLD() {
    consoleLog('\nRetrieving license details...', LoggerType.INFO);
    await this.page.getByText(/Activation key/i).first().waitFor({ timeout: 5000 }).catch(() => null);

    const textContent = await this.page.locator('body').innerText().catch(() => '');
    const keyMatch = /([A-Z0-9]{4}-){4}[A-Z0-9]{4}/.exec(textContent);
    const dateMatch = /\d{2}\.\d{2}\.\d{4}/.exec(textContent);
    const licenseKey = keyMatch ? keyMatch[0] : 'UNKNOWN-KEY';
    const expirationDate = dateMatch ? dateMatch[0] : 'Unknown';
    return [licenseKey.trim(), expirationDate.trim()];
  }
}

async function initBrowser({ headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}
function buildEmailObject(emailProvider, page) {
  const factory = EMAIL_PROVIDERS[emailProvider];
  if (!factory) throw new Error('Unsupported email provider: ' + emailProvider);
  return factory(page);
}

function writeOutput(text) {
  const filename = new Date().getDate() + '.' + (new Date().getMonth() + 1) + '.' + new Date().getFullYear() + '-output.txt';
  fs.appendFileSync(path.resolve(process.cwd(), filename), `${text}\n`, 'utf8');
}
async function runIteration(args, iteration) {
  let currentEmail = "";
  let browser = null;
  let context = null;
  let page = null;
  let emailPage = null;

  ({ browser, context, page } = await initBrowser({ headless: !args.no_headless }));
  emailPage = page;
  if (WEB_WRAPPER_EMAIL_PROVIDERS.includes(args.email_provider)) page = await context.newPage();

  try {
    const emailObj = buildEmailObject(args.email_provider, emailPage);
    consoleLog("[" + args.email_provider + "] Mail registration...", LoggerType.INFO);
    await emailObj.init();
    consoleLog("Mail registration completed successfully!", LoggerType.OK);
    currentEmail = emailObj.email;
    if (!String(currentEmail || "").trim()) throw new Error("Email was not configured.");

    await page.bringToFront().catch(() => null);
    const password = randomPassword(10);
    const registration = new EsetRegister(emailObj, password, page);
    await registration.createAccount();
    await registration.confirmAccount();
    const trial = new Trial(emailObj, page);
    await trial.sendRequestForKey();
    const [licenseKey, expirationDate] = await trial.getLD();
    const outputLine = ['', '-------------------------------------------------', `Account Email: ${emailObj.email}`, `Account Password: ${password}`, '', `Key: ${licenseKey}`, `Expires: ${expirationDate}`, '-------------------------------------------------', ''].join('\n');
    consoleLog(outputLine, LoggerType.INFO);
    writeOutput(outputLine);
    appendLogLine(outputLine, "INFO");
  } catch (err) {
    const errorMessage = err?.message || "Unknown error";
    const errorStack = err?.stack || errorMessage;
    consoleLog(`Iteration ${iteration} failed: ${errorMessage}`, LoggerType.ERROR);
    console.error(errorStack);
    appendLogLine(`Iteration ${iteration} failed: ${errorMessage}`, "ERROR");
    appendLogLine(errorStack, "ERROR");
    const dumpTargets = [{ page, label: "register-page" }, { page: emailPage, label: "email-page" }];
    const dumpPaths = [];
    const seenPages = new Set();
    for (const { page: targetPage, label } of dumpTargets) {
      if (!targetPage || seenPages.has(targetPage)) continue;
      seenPages.add(targetPage);
      const dumpPath = await dumpHtmlSnapshot(targetPage, iteration, currentEmail, errorMessage, label);
      if (dumpPath) dumpPaths.push(dumpPath);
    }
    consoleLog(dumpPaths.length ? `HTML dump(s) saved: ${dumpPaths.join('\n')}` : 'Failed to save HTML dump.', LoggerType.WARN);
    if (args.no_headless) {
      consoleLog("Operation failed; inspect the browser, then press Enter to exit.", LoggerType.WARN);
      await promptLine("Press Enter to continue: ").catch(() => null);
    }
    throw err;
  } finally {
    await context?.close().catch(() => null);
    await browser?.close().catch(() => null);
  }
}
async function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgv(argv); }
  catch (err) {
    consoleLog(err.message, LoggerType.ERROR);
    appendLogLine(err.message, "ERROR");
    throw err;
  }
  console.log(LOGO);
  appendLogLine(`Version: text=${VERSION[0]}, index=${VERSION[1]}`, "INFO");
  appendLogLine(`sys.argv equivalent: ${JSON.stringify(argv)}`, "INFO");
  clearOldDumpFiles();
  await runIteration(args, 1);
  consoleLog("Done.", LoggerType.INFO);
}
main(process.argv.slice(2)).catch((err) => {
  const message = err?.message || String(err);
  console.error(err?.stack || `[ FAILED ] ${message}`);
  process.exit(1);
});
