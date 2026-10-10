import type { Place } from '../nav/Search';

export interface NavPanelHandlers {
  onSearch(q: string): Promise<Place[]>;
  onPick(place: Place, setStatus: (s: string) => void): Promise<boolean>;
  onClear(): void;
  kakaoKey(): string;
  setKakaoKey(k: string): void;
  kakaoStatus(): 'none' | 'ok' | 'failed';
}

/** 목적지 검색 패널 (카카오 장소 검색 또는 내장 목록) */
export class NavPanel {
  private readonly root = document.createElement('div');
  private readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private readonly status: HTMLDivElement;
  isOpen = false;

  constructor(private readonly h: NavPanelHandlers) {
    this.root.id = 'nav-panel';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="nav-head">
        <span>목적지 검색</span>
        <button class="nav-x" aria-label="닫기">✕</button>
      </div>
      <form class="nav-form">
        <input type="search" placeholder="예: 남산서울타워, 판교역, 스타필드" autocomplete="off" enterkeyhint="search" />
        <button type="submit" class="primary">검색</button>
      </form>
      <div class="nav-status"></div>
      <ul class="nav-list"></ul>
      <div class="nav-foot">
        <button class="nav-clear">안내 종료</button>
        <button class="nav-key">카카오 검색 연결</button>
      </div>`;
    document.body.appendChild(this.root);
    this.input = this.root.querySelector('input')!;
    this.list = this.root.querySelector('.nav-list')!;
    this.status = this.root.querySelector('.nav-status')!;
    this.root.querySelector('.nav-x')!.addEventListener('click', () => this.close());
    this.root.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.run();
    });
    this.root.querySelector('.nav-clear')!.addEventListener('click', () => {
      this.h.onClear();
      this.setStatus('안내를 종료했습니다.');
    });
    this.root.querySelector('.nav-key')!.addEventListener('click', () => {
      const k = prompt(
        '카카오 개발자(developers.kakao.com) 앱의 JavaScript 키를 입력하세요.\n' +
          '플랫폼 > Web 에 이 사이트 주소(https://jngbnss.github.io)를 등록해야 검색이 동작합니다.\n' +
          '비워 두면 내장 목록(역·명소·지역명)으로 검색합니다.',
        this.h.kakaoKey(),
      );
      if (k !== null) {
        this.h.setKakaoKey(k);
        location.reload();
      }
    });
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });
    this.updateKeyHint();
  }

  private updateKeyHint() {
    const has = !!this.h.kakaoKey();
    this.setStatus(has ? '카카오 장소 검색으로 찾아요.' : '역·명소·지역명으로 찾아요. (카카오 검색을 연결하면 모든 장소 검색 가능)');
  }

  setStatus = (s: string) => {
    this.status.textContent = s;
  };

  open() {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    setTimeout(() => this.input.focus(), 50);
  }

  close() {
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.input.blur();
  }

  private async run() {
    const q = this.input.value;
    if (!q.trim()) return;
    this.setStatus('검색 중…');
    this.list.innerHTML = '';
    let results: Place[] = [];
    try {
      results = await this.h.onSearch(q);
    } catch {
      this.setStatus('검색 중 문제가 생겼어요.');
      return;
    }
    const st = this.h.kakaoStatus();
    if (!results.length) {
      this.setStatus(st === 'failed' ? '카카오 검색 연결에 실패해 내장 목록에서 찾았지만 결과가 없어요.' : '검색 결과가 없어요.');
      return;
    }
    this.setStatus(`${results.length}곳 · ${results[0].source === 'kakao' ? '카카오 장소 검색' : st === 'failed' ? '카카오 연결 실패 → 내장 목록' : '내장 목록'}`);
    for (const p of results) {
      const li = document.createElement('li');
      li.innerHTML = `<b></b><span></span>`;
      li.querySelector('b')!.textContent = p.name;
      li.querySelector('span')!.textContent = p.detail;
      li.addEventListener('click', async () => {
        if (await this.h.onPick(p, this.setStatus)) this.close();
      });
      this.list.appendChild(li);
    }
  }
}
