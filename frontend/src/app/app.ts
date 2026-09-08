import { CommonModule, DOCUMENT } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Subscription, finalize, timeout } from 'rxjs';

type ShortenResponse = {
  shortUrl: string;
  shortcode: string;
  originalUrl: string;
  createdAt: string | null;
  expiresAt: string | null;
};
type RecentLink = ShortenResponse & { savedAt: number };
type UrlStats = {
  shortCode: string;
  originalUrl: string;
  clickCount: number;
  createdAt: string | null;
  expiresAt: string | null;
  active: boolean;
};
type Analytics = {
  totalClicks: number;
  clicksByDay: Record<string, number>;
  clicksByHour: Record<string, number>;
  clicksByReferrer: Record<string, number>;
};
type ExpiryPreset = 'none' | 'day' | 'week' | 'month' | 'custom';

const HISTORY_KEY = 'tiny-link:history:v1';
const REMEMBER_KEY = 'tiny-link:remember-history';
const THEME_KEY = 'tiny-link:theme';
const HISTORY_LIMIT = 30;

function webUrl(value: string): URL | null {
  try {
    if (!/^https?:\/\/[^/\\]/i.test(value.trim()) || /\\/.test(value)) return null;
    const parsed = new URL(value.trim());
    return /^https?:$/.test(parsed.protocol) &&
      !!parsed.hostname &&
      !parsed.username &&
      !parsed.password &&
      !/\s/.test(value.trim())
      ? parsed
      : null;
  } catch {
    return null;
  }
}
function destinationValidator(control: AbstractControl) {
  return !control.value || webUrl(control.value) ? null : { webUrl: true };
}
function aliasValidator(control: AbstractControl) {
  const alias = String(control.value || '').trim();
  if (!alias) return null;
  return /^[a-zA-Z0-9_-]{1,64}$/.test(alias) &&
    !['shorten', 'stats', 'analytics', 'health'].includes(alias.toLowerCase())
    ? null
    : { alias: true };
}
function futureValidator(control: AbstractControl) {
  return !control.value || new Date(control.value).getTime() > Date.now() ? null : { future: true };
}
function localDateTime(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

@Component({
  imports: [CommonModule, ReactiveFormsModule],
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: true,
})
export class App {
  private readonly http = inject(HttpClient);
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private statsRequest?: Subscription;
  private analyticsRequest?: Subscription;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  private activeCode = '';
  private readonly now = signal(Date.now());

  protected readonly form = this.formBuilder.nonNullable.group({
    originalUrl: ['', [Validators.required, Validators.maxLength(2048), destinationValidator]],
    customAlias: ['', aliasValidator],
    expiresAt: ['', futureValidator],
  });
  protected readonly statsForm = this.formBuilder.nonNullable.group({
    shortCode: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(2048)]],
  });
  private readonly formValues = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  protected readonly loading = signal(false);
  protected readonly statsLoading = signal(false);
  protected readonly analyticsLoading = signal(false);
  protected readonly error = signal('');
  protected readonly statsError = signal('');
  protected readonly analyticsError = signal('');
  protected readonly result = signal<ShortenResponse | null>(null);
  protected readonly stats = signal<UrlStats | null>(null);
  protected readonly analytics = signal<Analytics | null>(null);
  protected readonly advancedOpen = signal(false);
  protected readonly expiryPreset = signal<ExpiryPreset>('none');
  protected readonly theme = signal<'light' | 'dark'>('light');
  protected readonly copiedUrl = signal('');
  protected readonly notification = signal('');
  protected readonly storageWarning = signal('');
  protected readonly recentLinks = signal<RecentLink[]>([]);
  protected readonly rememberHistory = signal(false);
  protected readonly searchQuery = signal('');
  protected readonly sortOrder = signal<'newest' | 'oldest'>('newest');
  protected readonly chartMode = signal<'day' | 'hour'>('day');
  protected readonly autoRefresh = signal(false);
  protected readonly lastUpdated = signal<Date | null>(null);
  protected readonly canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  protected get minExpiry(): string {
    return localDateTime(new Date(this.now() + 60_000));
  }

  protected readonly aliasPreview = computed(
    () => this.formValues().customAlias?.trim() || 'your-link',
  );
  protected readonly destinationPreview = computed(() => {
    const url = webUrl(this.formValues().originalUrl || '');
    return url ? { host: url.hostname, path: url.pathname + url.search + url.hash } : null;
  });
  protected readonly filteredLinks = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    return this.recentLinks()
      .filter((link) =>
        `${link.shortcode} ${link.shortUrl} ${link.originalUrl}`.toLowerCase().includes(query),
      )
      .sort((a, b) =>
        this.sortOrder() === 'oldest' ? a.savedAt - b.savedAt : b.savedAt - a.savedAt,
      );
  });
  protected readonly statsActive = computed(() => {
    const stats = this.stats();
    return (
      !!stats?.active && (!stats.expiresAt || new Date(stats.expiresAt).getTime() > this.now())
    );
  });
  protected readonly chartBars = computed(() => {
    const analytics = this.analytics();
    if (!analytics) return [];
    const count = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
    let bars: { label: string; count: number }[];
    if (this.chartMode() === 'hour') {
      bars = Array.from({ length: 24 }, (_, hour) => ({
        label: `${String(hour).padStart(2, '0')}:00`,
        count: count(analytics.clicksByHour?.[`${hour}:00`]),
      }));
    } else {
      // Include quiet calendar days without inventing sample clicks.
      bars = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(this.now());
        day.setDate(day.getDate() - (6 - index));
        const key = localDateTime(day).slice(0, 10);
        return { label: key, count: count(analytics.clicksByDay?.[key]) };
      });
    }
    const maximum = Math.max(1, ...bars.map((bar) => bar.count));
    return bars.map((bar) => ({ ...bar, height: (bar.count / maximum) * 100 }));
  });
  protected readonly hasChartClicks = computed(() => this.chartBars().some((bar) => bar.count > 0));

  constructor() {
    this.restorePreferences();
    const refreshTimer = setInterval(() => {
      if (this.document.visibilityState === 'hidden') return;
      this.now.set(Date.now());
      if (
        this.autoRefresh() &&
        this.activeCode &&
        !this.statsLoading() &&
        !this.analyticsLoading()
      ) {
        this.fetchStats(this.activeCode, true);
      }
    }, 30_000);
    this.destroyRef.onDestroy(() => {
      clearInterval(refreshTimer);
      clearTimeout(this.copiedTimer);
      this.statsRequest?.unsubscribe();
      this.analyticsRequest?.unsubscribe();
    });
  }

  protected fieldError(name: 'originalUrl' | 'customAlias' | 'expiresAt'): string {
    const control = this.form.controls[name];
    if (!control.touched || !control.invalid) return '';
    if (name === 'originalUrl')
      return control.hasError('required')
        ? 'Enter the destination for your short link.'
        : 'Enter a valid http:// or https:// URL, without spaces or a password (up to 2,048 characters).';
    if (name === 'customAlias')
      return 'Use 1–64 letters, numbers, hyphens or underscores. This name may be reserved.';
    return 'Choose an expiry date and time in the future.';
  }
  protected normalizeDestination(): void {
    const control = this.form.controls.originalUrl;
    const trimmed = control.value.trim();
    control.setValue(webUrl(trimmed)?.href || trimmed);
  }
  protected setExpiryPreset(preset: ExpiryPreset): void {
    this.expiryPreset.set(preset);
    const days = { day: 1, week: 7, month: 30 };
    if (preset === 'custom') {
      this.advancedOpen.set(true);
      return;
    }
    const date = new Date();
    if (preset !== 'none') date.setDate(date.getDate() + days[preset]);
    this.form.controls.expiresAt.setValue(preset === 'none' ? '' : localDateTime(date));
  }
  protected shortenUrl(): void {
    if (this.loading()) return;
    this.normalizeDestination();
    this.form.controls.expiresAt.updateValueAndValidity();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      if (this.form.controls.customAlias.invalid || this.form.controls.expiresAt.invalid)
        this.advancedOpen.set(true);
      return;
    }
    const raw = this.form.getRawValue();
    const payload = {
      originalUrl: raw.originalUrl,
      customAlias: raw.customAlias.trim() || null,
      // The existing API uses LocalDateTime; offset-aware expiry needs a coordinated backend change.
      expiresAt: raw.expiresAt
        ? raw.expiresAt.length === 16
          ? `${raw.expiresAt}:00`
          : raw.expiresAt
        : null,
    };
    this.loading.set(true);
    this.error.set('');
    this.result.set(null);
    this.http
      .post<ShortenResponse>('/api/shorten', payload)
      .pipe(
        timeout(15_000),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          if (
            !response ||
            !webUrl(response.shortUrl || '') ||
            !webUrl(response.originalUrl || '') ||
            !response.shortcode
          ) {
            this.error.set('The server returned an invalid link. Please try again.');
            return;
          }
          this.result.set(response);
          this.statsForm.patchValue({ shortCode: response.shortcode });
          this.recentLinks.update((links) =>
            [
              { ...response, savedAt: Date.now() },
              ...links.filter((link) => link.shortcode !== response.shortcode),
            ].slice(0, HISTORY_LIMIT),
          );
          this.persistHistory();
          this.notification.set('Your short link is ready to share.');
        },
        error: (error) =>
          this.error.set(
            this.getErrorMessage(error, 'Could not shorten the URL. Please try again.'),
          ),
      });
  }

  protected loadStats(): void {
    if (this.statsForm.invalid) {
      this.statsForm.markAllAsTouched();
      return;
    }
    const input = this.statsForm.getRawValue().shortCode.trim();
    let code = input;
    if (/^https?:\/\//i.test(input)) {
      const url = webUrl(input);
      try {
        code = url ? decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || '') : '';
      } catch {
        code = '';
      }
    }
    if (!code) {
      this.statsError.set('Enter a short code or a complete short link.');
      return;
    }
    if (this.statsLoading() && code === this.activeCode) return;
    this.statsForm.patchValue({ shortCode: code });
    this.autoRefresh.set(false);
    this.fetchStats(code, false);
  }
  protected viewStats(code: string): void {
    this.statsForm.patchValue({ shortCode: code });
    this.loadStats();
    const input = this.document.querySelector<HTMLInputElement>('#stats-form input');
    input?.focus({ preventScroll: true });
    input?.scrollIntoView?.({ behavior: 'instant', block: 'nearest' });
  }
  protected refreshStats(): void {
    if (this.activeCode && !this.statsLoading() && !this.analyticsLoading())
      this.fetchStats(this.activeCode, true);
  }
  protected toggleAutoRefresh(): void {
    this.autoRefresh.update((value) => !value);
  }
  private fetchStats(code: string, keepPrevious: boolean): void {
    this.statsRequest?.unsubscribe();
    this.analyticsRequest?.unsubscribe();
    this.activeCode = code;
    this.statsLoading.set(true);
    this.statsError.set('');
    this.analyticsError.set('');
    if (!keepPrevious) {
      this.stats.set(null);
      this.analytics.set(null);
      this.lastUpdated.set(null);
    }
    this.statsRequest = this.http
      .get<UrlStats>(`/api/stats/${encodeURIComponent(code)}`)
      .pipe(
        timeout(15_000),
        finalize(() => this.statsLoading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this.stats.set(response);
          this.now.set(Date.now());
          this.lastUpdated.set(new Date());
          this.loadAnalytics(code);
        },
        error: (error) => {
          this.statsError.set(
            this.getErrorMessage(error, 'Could not load this link. Please try again.'),
          );
          this.autoRefresh.set(false);
        },
      });
  }
  private loadAnalytics(code: string): void {
    this.analyticsLoading.set(true);
    this.analyticsRequest = this.http
      .get<Analytics>(`/api/analytics/${encodeURIComponent(code)}`)
      .pipe(
        timeout(15_000),
        finalize(() => this.analyticsLoading.set(false)),
      )
      .subscribe({
        next: (response) => {
          // Store aggregate counts only; visitor IP addresses are never rendered or saved.
          this.analytics.set({
            totalClicks: response.totalClicks,
            clicksByDay: response.clicksByDay,
            clicksByHour: response.clicksByHour,
            clicksByReferrer: response.clicksByReferrer,
          });
        },
        error: (error) => {
          this.analytics.set(null);
          this.analyticsError.set(
            this.getErrorMessage(error, 'Click activity is unavailable. Refresh to try again.'),
          );
          this.autoRefresh.set(false);
        },
      });
  }

  protected async copyLink(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copiedUrl.set(url);
      this.notification.set('Link copied to clipboard.');
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedUrl.set(''), 2500);
    } catch {
      this.notification.set(
        'Could not access the clipboard. Select the short link and copy it manually.',
      );
    }
  }
  protected async shareLink(link: ShortenResponse): Promise<void> {
    if (!this.canShare) return this.copyLink(link.shortUrl);
    try {
      await navigator.share({ title: 'A link for you', url: link.shortUrl });
      this.notification.set('Link shared.');
    } catch (error) {
      if ((error as { name?: string })?.name !== 'AbortError')
        this.notification.set('Sharing is unavailable. Use Copy link instead.');
    }
  }
  protected toggleTheme(): void {
    this.theme.update((value) => (value === 'light' ? 'dark' : 'light'));
    try {
      localStorage.setItem(THEME_KEY, this.theme());
    } catch {
      /* Still works for this session. */
    }
  }
  protected toggleRememberHistory(): void {
    const remember = !this.rememberHistory();
    this.storageWarning.set('');
    try {
      if (remember) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(this.recentLinks()));
        localStorage.setItem(REMEMBER_KEY, 'true');
      } else {
        localStorage.removeItem(HISTORY_KEY);
        localStorage.removeItem(REMEMBER_KEY);
      }
      this.rememberHistory.set(remember);
      this.notification.set(
        remember
          ? 'Recent links will be remembered on this browser.'
          : 'Saved history removed from this browser. Current-session links remain visible.',
      );
    } catch {
      this.storageWarning.set(
        'Browser storage is unavailable. Your history preference could not be saved.',
      );
    }
  }
  protected removeRecent(code: string): void {
    this.recentLinks.update((links) => links.filter((link) => link.shortcode !== code));
    this.persistHistory();
    this.notification.set('Removed from recent links. The short link still works.');
  }
  protected exportHistory(): void {
    if (!this.filteredLinks().length) return;
    // Quote cells and neutralize spreadsheet formulas in user-controlled aliases.
    const csvCell = (value: string) =>
      `"${(/^[\s]*[=+\-@]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
    const rows = [
      ['Short link', 'Destination', 'Short code', 'Created at', 'Expires at'],
      ...this.filteredLinks().map((link) => [
        link.shortUrl,
        link.originalUrl,
        link.shortcode,
        link.createdAt || '',
        link.expiresAt || '',
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = 'tiny-link-history.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.notification.set('Recent links exported.');
  }
  protected hostname(url: string): string {
    return webUrl(url)?.hostname || url;
  }
  protected formatExpiry(value: string | null): string {
    if (!value) return 'No expiry';
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return 'Expiry unavailable';
    if (time <= this.now()) return 'Expired';
    const days = Math.ceil((time - this.now()) / 86_400_000);
    return days === 1 ? 'Expires within 24h' : `Expires in ${days} days`;
  }
  private persistHistory(): void {
    if (!this.rememberHistory()) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.recentLinks()));
      this.storageWarning.set('');
    } catch {
      this.storageWarning.set(
        'Recent changes could not be saved to this browser. Existing saved history may be out of date.',
      );
    }
  }
  private restorePreferences(): void {
    try {
      const theme = localStorage.getItem(THEME_KEY);
      this.theme.set(
        theme === 'dark' || theme === 'light'
          ? theme
          : this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light',
      );
      if (localStorage.getItem(REMEMBER_KEY) !== 'true') return;
      this.rememberHistory.set(true);
      const history: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(history)) throw new Error('Invalid history');
      const validDate = (value: unknown) =>
        value === null || (typeof value === 'string' && Number.isFinite(new Date(value).getTime()));
      const links = history.filter(
        (link): link is RecentLink =>
          link &&
          typeof link.shortUrl === 'string' &&
          !!webUrl(link.shortUrl) &&
          typeof link.originalUrl === 'string' &&
          !!webUrl(link.originalUrl) &&
          typeof link.shortcode === 'string' &&
          !!link.shortcode &&
          link.shortcode.length <= 64 &&
          typeof link.savedAt === 'number' &&
          Number.isFinite(link.savedAt) &&
          validDate(link.createdAt) &&
          validDate(link.expiresAt),
      );
      this.recentLinks.set(
        links
          .filter(
            (link, index) =>
              links.findIndex((other) => other.shortcode === link.shortcode) === index,
          )
          .slice(0, HISTORY_LIMIT),
      );
    } catch {
      this.storageWarning.set(
        'Saved history could not be loaded. New links will still work in this session.',
      );
    }
  }
  private getErrorMessage(error: HttpErrorResponse | Error, fallback: string): string {
    if (error.name === 'TimeoutError')
      return 'The server took too long to respond. Please try again.';
    if (!(error instanceof HttpErrorResponse)) return fallback;
    if (error.status === 429)
      return 'You have created links too quickly. Please wait before trying again.';
    if (typeof error.error?.error === 'string' && error.error.error.trim())
      return error.error.error;
    return error.status === 0
      ? 'Could not reach the server. Check your connection and try again.'
      : fallback;
  }
}
