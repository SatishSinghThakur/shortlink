import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let app: App;
  const historyKey = 'tiny-link:history:v1';
  const rememberKey = 'tiny-link:remember-history';
  const themeKey = 'tiny-link:theme';
  const shortenResponse = {
    shortUrl: 'http://localhost:8080/guide', shortcode: 'guide',
    originalUrl: 'https://example.com/guide', createdAt: '2026-09-07T12:00:00', expiresAt: null,
  };
  const statsResponse = {
    shortCode: 'guide', originalUrl: 'https://example.com/guide', clickCount: 42,
    createdAt: '2026-09-07T12:00:00', expiresAt: null, active: true,
  };
  const emptyAnalytics = { totalClicks: 0, clicksByDay: {}, clicksByHour: {}, clicksByReferrer: {} };
  const storage = new Map<string, string>();
  const fakeStorage: Storage = {
    get length() { return storage.size; },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => [...storage.keys()][index] ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, String(value)),
  };

  function clearPreferences(): void {
    [historyKey, rememberKey, themeKey].forEach(key => localStorage.removeItem(key));
  }
  function createFixture(): void {
    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }
  function input(formId: string, controlName: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`#${formId} [formControlName="${controlName}"]`)!;
  }
  function click(selector: string): void {
    element.querySelector<HTMLButtonElement>(selector)!.click();
    fixture.detectChanges();
  }
  function fill(formId: string, controlName: string, value: string): void {
    if (formId === 'shorten-form' && controlName !== 'originalUrl' && !app['advancedOpen']()) {
      click('.advanced-toggle');
    }
    const control = input(formId, controlName);
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }
  function submit(formId: string): void {
    element.querySelector<HTMLFormElement>(`#${formId}`)!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }
  function submitButton(formId: string): HTMLButtonElement {
    return element.querySelector<HTMLButtonElement>(`#${formId} button[type="submit"]`)!;
  }
  function createLink(code = 'guide'): void {
    fill('shorten-form', 'originalUrl', `https://example.com/${code}`);
    submit('shorten-form');
    http.expectOne('/api/shorten').flush({ ...shortenResponse,
      shortcode: code, shortUrl: `http://localhost:8080/${code}`, originalUrl: `https://example.com/${code}` });
    fixture.detectChanges();
  }
  function loadStats(code = 'guide'): void {
    fill('stats-form', 'shortCode', code);
    submit('stats-form');
    http.expectOne(`/api/stats/${encodeURIComponent(code)}`).flush({ ...statsResponse, shortCode: code });
  }
  function localDateTime(date: Date): string {
    const part = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
  }

  beforeEach(async () => {
    // Node's optional native storage can shadow jsdom's browser storage.
    vi.stubGlobal('localStorage', fakeStorage);
    clearPreferences();
    await TestBed.configureTestingModule({ imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    createFixture();
  });
  afterEach(() => {
    try {
      fixture.destroy();
      http.verify();
    } finally {
      vi.restoreAllMocks();
      clearPreferences();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('renders the shortlink forms', () => {
    expect(element.querySelector('h1')?.textContent).toContain('Shortlink');
    expect(element.querySelector('#shorten-form')).not.toBeNull();
    expect(element.querySelector('#stats-form')).not.toBeNull();
  });

  it('rejects malformed, credential-bearing and non-web destinations, then normalizes a valid URL', () => {
    submit('shorten-form');
    expect(app['fieldError']('originalUrl')).toContain('Enter the destination');
    for (const value of ['ftp://example.com', 'javascript:alert(1)', 'https://',
      'https:example.com', 'https:/example.com', 'https://example.com/a b', 'https://user:secret@example.com']) {
      fill('shorten-form', 'originalUrl', value);
      submit('shorten-form');
      expect(app['fieldError']('originalUrl')).toContain('valid http:// or https://');
    }
    http.expectNone('/api/shorten');
    fill('shorten-form', 'originalUrl', '  HTTPS://EXAMPLE.COM/guide  ');
    submit('shorten-form');
    const request = http.expectOne('/api/shorten');
    expect(request.request.body.originalUrl).toBe('https://example.com/guide');
    request.flush(shortenResponse);
  });

  it('rejects invalid or reserved aliases and past expiry before sending a request', () => {
    fill('shorten-form', 'originalUrl', 'https://example.com/guide');
    for (const alias of ['bad/alias', 'has space', 'ANALYTICS', 'a'.repeat(65)]) {
      fill('shorten-form', 'customAlias', alias);
      submit('shorten-form');
      expect(app['fieldError']('customAlias')).toContain('1–64');
    }
    fill('shorten-form', 'customAlias', 'guide');
    fill('shorten-form', 'expiresAt', localDateTime(new Date(Date.now() - 86_400_000)));
    submit('shorten-form');
    expect(app['fieldError']('expiresAt')).toContain('in the future');
    http.expectNone('/api/shorten');
  });

  it('sends a trimmed alias and future local expiry, then displays the created link', () => {
    const expiry = localDateTime(new Date(Date.now() + 7 * 86_400_000));
    fill('shorten-form', 'originalUrl', 'https://example.com/guide');
    fill('shorten-form', 'customAlias', ' guide ');
    fill('shorten-form', 'expiresAt', expiry);
    submit('shorten-form');
    const request = http.expectOne('/api/shorten');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ originalUrl: 'https://example.com/guide',
      customAlias: 'guide', expiresAt: `${expiry}:00` });
    request.flush({ ...shortenResponse, expiresAt: `${expiry}:00` });
    fixture.detectChanges();
    expect(element.querySelector(`a[href="${shortenResponse.shortUrl}"]`)).not.toBeNull();
    expect(input('stats-form', 'shortCode').value).toBe('guide');
    expect(app['recentLinks']()).toHaveLength(1);
  });

  it('updates destination and alias previews and applies expiry presets', () => {
    fill('shorten-form', 'originalUrl', 'https://example.com/guide?source=news');
    fill('shorten-form', 'customAlias', ' newsletter ');
    expect(app['destinationPreview']()).toEqual({ host: 'example.com', path: '/guide?source=news' });
    expect(app['aliasPreview']()).toBe('newsletter');
    app['setExpiryPreset']('week');
    const expiry = new Date(app['form'].controls.expiresAt.value).getTime();
    expect(expiry - Date.now()).toBeGreaterThan(6 * 86_400_000);
    expect(expiry - Date.now()).toBeLessThan(8 * 86_400_000);
    app['setExpiryPreset']('none');
    expect(app['form'].controls.expiresAt.value).toBe('');
  });

  it('sends null optional values and prevents duplicate submission while creating a link', () => {
    fill('shorten-form', 'originalUrl', 'https://example.com/guide');
    fill('shorten-form', 'customAlias', '   ');
    submit('shorten-form');
    submit('shorten-form');
    expect(submitButton('shorten-form').disabled).toBe(true);
    const request = http.expectOne('/api/shorten');
    expect(request.request.body).toEqual({ originalUrl: 'https://example.com/guide', customAlias: null, expiresAt: null });
    request.flush(shortenResponse);
    fixture.detectChanges();
    expect(submitButton('shorten-form').disabled).toBe(false);
  });

  it('shows creation errors and clears them when another attempt starts', () => {
    fill('shorten-form', 'originalUrl', 'https://example.com/guide');
    submit('shorten-form');
    http.expectOne('/api/shorten').flush({ error: 'That alias is already in use.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('That alias is already in use.');
    expect(submitButton('shorten-form').disabled).toBe(false);
    submit('shorten-form');
    expect(element.textContent).not.toContain('That alias is already in use.');
    http.expectOne('/api/shorten').flush(shortenResponse);
  });

  it('explains rate limiting without guessing when another request will be allowed', () => {
    fill('shorten-form', 'originalUrl', 'https://example.com/guide');
    submit('shorten-form');
    http.expectOne('/api/shorten').flush({}, { status: 429, statusText: 'Too Many Requests' });
    fixture.detectChanges();
    expect(element.textContent).toContain('Please wait before trying again.');
    expect(submitButton('shorten-form').disabled).toBe(false);
  });

  it('times out a stalled creation request and re-enables the form', () => {
    vi.useFakeTimers();
    fill('shorten-form', 'originalUrl', 'https://example.com/guide');
    submit('shorten-form');
    const request = http.expectOne('/api/shorten');
    vi.advanceTimersByTime(15_001);
    fixture.detectChanges();
    expect(request.cancelled).toBe(true);
    expect(element.textContent).toContain('The server took too long to respond.');
    expect(submitButton('shorten-form').disabled).toBe(false);
  });

  it('does not display or remember unsafe links returned by the server', () => {
    fill('shorten-form', 'originalUrl', 'https://example.com/guide');
    submit('shorten-form');
    http.expectOne('/api/shorten').flush({ ...shortenResponse, shortUrl: 'javascript:alert(1)' });
    fixture.detectChanges();
    expect(app['result']()).toBeNull();
    expect(app['recentLinks']()).toHaveLength(0);
    expect(element.textContent).toContain('The server returned an invalid link.');
  });

  it('does not request stats for empty codes, host-only links or malformed escapes', () => {
    for (const value of ['', '   ', 'https://example.com/', 'https://example.com/%E0%A4%A']) {
      fill('stats-form', 'shortCode', value);
      submit('stats-form');
    }
    http.expectNone(request => request.url.startsWith('/api/stats/'));
  });

  it('extracts and encodes a code from a complete short link, then fetches analytics', () => {
    fill('stats-form', 'shortCode', ' https://short.example/guide%2F2026?campaign=mail#share ');
    submit('stats-form');
    expect(submitButton('stats-form').disabled).toBe(true);
    const request = http.expectOne('/api/stats/guide%2F2026');
    expect(request.request.method).toBe('GET');
    request.flush({ ...statsResponse, shortCode: 'guide/2026' });
    const analyticsRequest = http.expectOne('/api/analytics/guide%2F2026');
    expect(analyticsRequest.request.method).toBe('GET');
    analyticsRequest.flush(emptyAnalytics);
    fixture.detectChanges();
    expect(input('stats-form', 'shortCode').value).toBe('guide/2026');
    expect(element.textContent).toContain('https://example.com/guide');
    expect(element.textContent).toContain('42');
    expect(submitButton('stats-form').disabled).toBe(false);
  });

  it('shows a readable stats failure without requesting analytics', () => {
    fill('stats-form', 'shortCode', 'guide');
    submit('stats-form');
    http.expectOne('/api/stats/guide').flush('Unexpected server failure', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Could not load this link.');
    expect(submitButton('stats-form').disabled).toBe(false);
    http.expectNone('/api/analytics/guide');
  });

  it('charts real aggregate counts with quiet days and hours as zero, excluding visitor data', () => {
    const today = localDateTime(new Date()).slice(0, 10);
    loadStats();
    http.expectOne('/api/analytics/guide').flush({ ...emptyAnalytics, totalClicks: 3,
      clicksByDay: { [today]: 3 }, clicksByHour: { '0:00': 2, '13:00': 1 },
      recentClicks: [{ ipAddress: 'sensitive-visitor-ip' }] });
    fixture.detectChanges();
    expect(app['chartBars']()).toHaveLength(7);
    expect(app['chartBars']().slice(0, 6).every(bar => bar.count === 0 && bar.height === 0)).toBe(true);
    expect(app['chartBars']()[6]).toEqual({ label: today, count: 3, height: 100 });
    click('.segment-control button:last-child');
    expect(app['chartBars']()).toHaveLength(24);
    expect(app['chartBars']()[0]).toEqual({ label: '00:00', count: 2, height: 100 });
    expect(app['chartBars']()[13]).toEqual({ label: '13:00', count: 1, height: 50 });
    expect(app['chartBars']()[1]).toEqual({ label: '01:00', count: 0, height: 0 });
    expect(app['analytics']()).not.toHaveProperty('recentClicks');
    expect(element.textContent).not.toContain('sensitive-visitor-ip');
    expect(localStorage.getItem(historyKey)).toBeNull();
  });

  it('keeps stats available when analytics fails and can refresh both requests', () => {
    loadStats();
    http.expectOne('/api/analytics/guide').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(app['stats']()?.clickCount).toBe(42);
    expect(app['analytics']()).toBeNull();
    expect(element.textContent).toContain('Click activity is unavailable.');
    click('.refresh-button');
    expect(app['stats']()?.clickCount).toBe(42);
    http.expectOne('/api/stats/guide').flush(statsResponse);
    http.expectOne('/api/analytics/guide').flush(emptyAnalytics);
    fixture.detectChanges();
    expect(app['analyticsError']()).toBe('');
    expect(app['hasChartClicks']()).toBe(false);
    expect(app['chartBars']().every(bar => bar.count === 0 && bar.height === 0)).toBe(true);
  });

  it('cancels old stats and analytics requests when another link is selected', () => {
    fill('stats-form', 'shortCode', 'first');
    submit('stats-form');
    const first = http.expectOne('/api/stats/first');
    fill('stats-form', 'shortCode', 'second');
    submit('stats-form');
    expect(first.cancelled).toBe(true);
    http.expectOne('/api/stats/second').flush({ ...statsResponse, shortCode: 'second' });
    const secondAnalytics = http.expectOne('/api/analytics/second');
    fill('stats-form', 'shortCode', 'third');
    submit('stats-form');
    expect(secondAnalytics.cancelled).toBe(true);
    http.expectOne('/api/stats/third').flush({ ...statsResponse, shortCode: 'third', clickCount: 9 });
    http.expectOne('/api/analytics/third').flush({ ...emptyAnalytics, totalClicks: 9 });
    fixture.detectChanges();
    expect(app['stats']()?.shortCode).toBe('third');
    expect(app['analytics']()?.totalClicks).toBe(9);
  });

  it('remembers links only after opt-in and removes saved history when opted out', () => {
    createLink();
    expect(localStorage.getItem(historyKey)).toBeNull();
    expect(localStorage.getItem(rememberKey)).toBeNull();
    click('.remember-toggle');
    expect(localStorage.getItem(rememberKey)).toBe('true');
    expect(JSON.parse(localStorage.getItem(historyKey)!)).toHaveLength(1);
    createLink('newsletter');
    expect(JSON.parse(localStorage.getItem(historyKey)!)).toHaveLength(2);
    click('.remember-toggle');
    expect(localStorage.getItem(historyKey)).toBeNull();
    expect(localStorage.getItem(rememberKey)).toBeNull();
    expect(app['recentLinks']()).toHaveLength(2);
  });

  it('does not restore stored history without browser opt-in', () => {
    fixture.destroy();
    localStorage.setItem(historyKey, JSON.stringify([{ ...shortenResponse, savedAt: Date.now() }]));
    createFixture();
    expect(app['recentLinks']()).toHaveLength(0);
    expect(app['rememberHistory']()).toBe(false);
  });

  it('restores only safe valid records, removes duplicates and caps browser history', () => {
    fixture.destroy();
    const valid = { ...shortenResponse, savedAt: Date.now() };
    localStorage.setItem(rememberKey, 'true');
    localStorage.setItem(historyKey, JSON.stringify([null,
      { ...valid, shortUrl: 'javascript:alert(1)' },
      { ...valid, originalUrl: 'https://user:secret@example.com' },
      { ...valid, savedAt: 'yesterday' }, { ...valid, expiresAt: 'invalid' }, valid, valid,
      ...Array.from({ length: 35 }, (_, i) => ({ ...valid, shortcode: `link-${i}` }))]));
    createFixture();
    expect(app['recentLinks']()).toHaveLength(30);
    expect(app['recentLinks']().filter(link => link.shortcode === 'guide')).toHaveLength(1);
    expect(element.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('handles corrupt history and unavailable storage without breaking creation', () => {
    fixture.destroy();
    localStorage.setItem(rememberKey, 'true');
    localStorage.setItem(historyKey, '{broken json');
    createFixture();
    expect(app['recentLinks']()).toHaveLength(0);
    expect(app['storageWarning']()).toContain('Saved history could not be loaded.');
    vi.spyOn(fakeStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });
    createLink();
    expect(app['result']()?.shortcode).toBe('guide');
    expect(app['storageWarning']()).toContain('could not be saved');
  });

  it('filters and sorts recent links and removes them locally without a backend DELETE', () => {
    app['recentLinks'].set([
      { ...shortenResponse, savedAt: 1 },
      { ...shortenResponse, shortcode: 'news', originalUrl: 'https://news.example.com', savedAt: 3 },
      { ...shortenResponse, shortcode: 'docs', originalUrl: 'https://docs.example.com', savedAt: 2 },
    ]);
    fixture.detectChanges();
    expect(app['filteredLinks']().map(link => link.shortcode)).toEqual(['news', 'docs', 'guide']);
    const sort = element.querySelector<HTMLSelectElement>('.sort-control select')!;
    sort.value = 'oldest';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(app['filteredLinks']().map(link => link.shortcode)).toEqual(['guide', 'docs', 'news']);
    const search = element.querySelector<HTMLInputElement>('.search-input input')!;
    search.value = ' DOCS.EXAMPLE ';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(app['filteredLinks']().map(link => link.shortcode)).toEqual(['docs']);
    click('.remember-toggle');
    click('.forget-button');
    expect(app['filteredLinks']()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(historyKey)!)).toHaveLength(2);
    expect(app['notification']()).toContain('The short link still works.');
    http.expectNone(request => request.method === 'DELETE');
  });

  it('copies a link and resets its feedback state', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await app['copyLink'](shortenResponse.shortUrl);
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith(shortenResponse.shortUrl);
    expect(app['copiedUrl']()).toBe(shortenResponse.shortUrl);
    expect(app['notification']()).toContain('Link copied to clipboard.');
    vi.advanceTimersByTime(2500);
    expect(app['copiedUrl']()).toBe('');
  });

  it('provides a manual-copy fallback when clipboard permission is rejected', async () => {
    vi.stubGlobal('navigator', { clipboard: {
      writeText: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
    } });
    await app['copyLink'](shortenResponse.shortUrl);
    fixture.detectChanges();
    expect(app['copiedUrl']()).toBe('');
    expect(app['notification']()).toContain('copy it manually');
  });

  it('auto-refreshes only in a visible page and stops timers and requests on destroy', () => {
    fixture.destroy();
    vi.useFakeTimers();
    createFixture();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    loadStats();
    http.expectOne('/api/analytics/guide').flush(emptyAnalytics);
    fixture.detectChanges();
    click('.auto-refresh');
    visibility.mockReturnValue('hidden');
    vi.advanceTimersByTime(30_000);
    http.expectNone('/api/stats/guide');
    visibility.mockReturnValue('visible');
    vi.advanceTimersByTime(30_000);
    http.expectOne('/api/stats/guide').flush({ ...statsResponse, clickCount: 43 });
    http.expectOne('/api/analytics/guide').flush({ ...emptyAnalytics, totalClicks: 43 });
    expect(app['stats']()?.clickCount).toBe(43);
    vi.advanceTimersByTime(30_000);
    const pending = http.expectOne('/api/stats/guide');
    fixture.destroy();
    expect(pending.cancelled).toBe(true);
    vi.advanceTimersByTime(60_000);
    http.expectNone('/api/stats/guide');
  });

  it('restores and persists theme independently of history opt-in', () => {
    fixture.destroy();
    localStorage.setItem(themeKey, 'dark');
    createFixture();
    expect(app['theme']()).toBe('dark');
    click('.theme-toggle');
    expect(app['theme']()).toBe('light');
    expect(localStorage.getItem(themeKey)).toBe('light');
    expect(localStorage.getItem(rememberKey)).toBeNull();
  });
});
