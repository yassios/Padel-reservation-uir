import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DateTime } from 'luxon';
import { ArrowDown, ArrowRight, CalendarDays, Check, ChevronRight, CircleHelp, Clock3, LayoutGrid, LogOut, MapPin, Plus, ShieldCheck, Users, X, Ban, Pencil, LoaderCircle } from 'lucide-react';
import './styles.css';

type User = { id: string; name: string; email: string; role: 'student' | 'admin'; active: boolean };
type Student = Omit<User, 'role'>;
type Slot = { date: string; hour: number; courtId: number; state: 'available' | 'booked' | 'closed' | 'past'; reason: string | null };
type Availability = { weekStart: string; now: string; timezone: string; slots: Slot[] };
type Reservation = { id: string; student_id: string; student_name: string; student_email: string; court_id: number; court_name: string; date: string; hour: number; status: 'confirmed' | 'cancelled'; week_start: string };
type Closure = { id: string; court_id: number; date: string; start_hour: number; end_hour: number; reason: string };
type Tab = 'courts' | 'reservations' | 'students' | 'closures';
const ZONE = 'Africa/Casablanca';
const localNow = () => DateTime.now().setZone(ZONE);
const dateLabel = (date: string, format = 'ccc, d MMM') => DateTime.fromISO(date, { zone: ZONE }).toFormat(format);
const time = (hour: number) => `${hour.toString().padStart(2, '0')}:00`;
const startTime = (r: { date: string; hour: number }) => DateTime.fromISO(`${r.date}T${time(r.hour)}`, { zone: ZONE });

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unable to reach the server. Please try again.' }));
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('session-expired'));
    throw new Error(error.error || 'Request failed.');
  }
  return response.status === 204 ? undefined as T : response.json();
}

function CourtMark({ small = false }: { small?: boolean }) {
  return <div className={`court-mark ${small ? 'small' : ''}`} aria-hidden="true"><span /><i /></div>;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { onLogin((await api<{ user: User }>('/auth/login', 'POST', { email, password })).user); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <section className="login-story"><a className="brand" href="/"><CourtMark small /><span>UIR<span className="brand-light">PADEL</span></span></a>
      <div className="login-pitch"><span className="eyebrow light">THE CAMPUS COURT CLUB</span><h1>Less scrolling.<br />More playing<span>.</span></h1><p>Your next great match starts right here.<br />Two courts. One campus. An hour for you.</p><div className="login-court"><CourtMark /><span className="ball" /></div></div>
      <span className="login-foot">Université Internationale de Rabat <span>EST. ON CAMPUS</span></span>
    </section>
    <section className="login-form-wrap"><form className="login-form" onSubmit={submit}>
      <span className="eyebrow">WELCOME TO YOUR NEXT MATCH</span><h2>Good to see you.</h2><p>Sign in to find your time on the court.</p>
      {error && <div className="alert error" role="alert">{error}</div>}
      <label>University email<input type="email" autoComplete="username" required placeholder="you@uir.ac.ma" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" /></label>
      <button className="button primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Step onto the court'}<ArrowRight size={18} /></button>
      <div className="demo-box"><span className="eyebrow">TAKE A LOOK AROUND</span><p>This is a campus demo. Choose an account to fill in its credentials.</p><div className="demo-options">
        <button type="button" onClick={() => { setEmail('amine@uir.ac.ma'); setPassword('Student123!'); }}>Student <ArrowRight size={14} /></button>
        <button type="button" onClick={() => { setEmail('admin@uir.ac.ma'); setPassword('Admin123!'); }}>Administrator <ArrowRight size={14} /></button>
      </div></div><p className="login-note"><ShieldCheck size={15} /> A little fair play: one hour, per student, per week.</p>
    </form></section>
  </div>;
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-inner"><button type="button" className="icon-button close" aria-label="Close dialog" onClick={onClose}><X size={20} /></button><span className="eyebrow">UIR PADEL</span><h2 id={titleId}>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}{children}</div></dialog>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('courts');
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [court, setCourt] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [studentId, setStudentId] = useState('');
  const [studentModal, setStudentModal] = useState<Student | 'new' | null>(null);
  const [closureModal, setClosureModal] = useState(false);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const [removingClosure, setRemovingClosure] = useState<Closure | null>(null);
  const [modalError, setModalError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api<{ user: User }>('/auth/me').then(data => setUser(data.user)).catch(e => { if (e.message !== 'Please sign in.') setError(e.message); }).finally(() => setLoading(false));
    const expire = () => { setUser(null); setError('Your session has ended. Please sign in again.'); };
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  async function refresh(currentUser = user) {
    if (!currentUser) return;
    setRefreshing(true);
    try {
      const [a, r, s, c] = await Promise.all([
        api<Availability>('/availability'), api<{ reservations: Reservation[] }>('/reservations'),
        currentUser.role === 'admin' ? api<{ students: Student[] }>('/admin/students') : Promise.resolve({ students: [] }),
        currentUser.role === 'admin' ? api<{ closures: Closure[] }>('/admin/closures') : Promise.resolve({ closures: [] }),
      ]);
      setAvailability(a); setReservations(r.reservations); setStudents(s.students); setClosures(c.closures); setError('');
    } catch (e) { setError((e as Error).message); }
    finally { setRefreshing(false); }
  }
  useEffect(() => { if (user) { setAvailability(null); setReservations([]); setTab('courts'); refresh(user); } }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => { setTick(t => t + 1); refresh(); }, 60_000);
    const focus = () => { refresh(); };
    window.addEventListener('focus', focus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [user]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { setModalError(''); }, [selected, studentModal, closureModal, cancelling, removingClosure]);

  async function mutate(action: () => Promise<unknown>, success: string, close: () => void) {
    setBusy(true); setModalError('');
    try { await action(); close(); setNotice(success); await refresh(); }
    catch (e) { setModalError((e as Error).message); await refresh(); }
    finally { setBusy(false); }
  }
  if (loading) return <div className="initial-loading"><CourtMark small /><LoaderCircle className="spin" /><span>Getting the courts ready…</span></div>;
  if (!user) return <>{error && <div className="session-notice" role="alert">{error}</div>}<Login onLogin={u => { setError(''); setUser(u); }} /></>;
  const admin = user.role === 'admin';
  const now = localNow();
  void tick;
  const monday = availability ? DateTime.fromISO(availability.weekStart, { zone: ZONE }) : now.startOf('week');
  const days = Array.from({ length: 5 }, (_, day) => monday.plus({ days: day }));
  const myWeekly = reservations.find(r => r.student_id === user.id && r.status === 'confirmed' && r.week_start === monday.toISODate());
  const upcoming = reservations.filter(r => r.status === 'confirmed' && startTime(r) > now).sort((a, b) => startTime(a).toMillis() - startTime(b).toMillis());
  const availableCount = availability?.slots.filter(s => s.state === 'available' && startTime(s) > now).length ?? 0;
  const initials = user.name.split(' ').map(n => n[0]).slice(0, 2).join('');
  const nav = [{ id: 'courts' as Tab, label: 'Book a court', icon: LayoutGrid }, { id: 'reservations' as Tab, label: admin ? 'Reservations' : 'My reservations', icon: CalendarDays }, ...(admin ? [{ id: 'students' as Tab, label: 'Students', icon: Users }, { id: 'closures' as Tab, label: 'Court closures', icon: Ban }] : [])];
  const nextBooking = upcoming[0];
  function pickSlot(slot: Slot) {
    if (slot.state !== 'available' || startTime(slot) <= localNow()) return;
    setSelected(slot); setStudentId(editing?.student_id ?? '');
  }
  const closeBooking = () => { setSelected(null); setEditing(null); };

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/" aria-label="UIR Padel home"><CourtMark small /><span>UIR<span className="brand-light">PADEL</span></span></a><div className="sidebar-label">YOUR CAMPUS. YOUR COURT.</div>
      <nav aria-label="Main navigation">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'nav-item active' : 'nav-item'} onClick={() => { setTab(id); setEditing(null); }}><Icon size={19} />{label}{id === 'courts' && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="fair-play"><span className="fair-icon"><ShieldCheck size={22} /></span><h3>A court for everyone.</h3><p>One hour a week.<br />Make it a good one.</p><span>THAT’S THE SPIRIT OF PLAY <ArrowRight size={13} /></span></div><a className="campus-link" href="https://www.uir.ac.ma" target="_blank" rel="noreferrer"><MapPin size={15} /> International University of Rabat<ArrowRight size={13} /></a><div className="sidebar-footer"><span className="live-dot" /> CAMPUS SPORTS CLUB</div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Campus sports <ChevronRight size={14} /><strong>Padel courts</strong></div><div className="topbar-right"><span className="timezone"><span className="live-dot" /> Morocco local time</span><div className="profile"><div className="avatar">{initials}</div><div><strong>{user.name}</strong><span>{admin ? 'Administrator' : 'UIR Student'}</span></div></div><button className="icon-button" title="Sign out" aria-label="Sign out" onClick={async () => { try { await api('/auth/logout', 'POST'); setUser(null); } catch (e) { setError((e as Error).message); } }}><LogOut size={18} /></button></div></header>
      <main><div className="page-heading"><div><span className="eyebrow">UIR PADEL CLUB <span>/</span> {admin ? 'ADMINISTRATION' : 'LET’S GET MOVING'}</span><h1>{tab === 'courts' ? <>Your next match<br className="mobile-break" /> starts here<span className="accent">.</span></> : tab === 'reservations' ? admin ? 'Every match, in one place.' : 'Your time on the court.' : tab === 'students' ? 'The campus community.' : 'Keep the courts in shape.'}</h1><p>{tab === 'courts' ? 'A study break worth taking. Pick a court, find your hour, and play.' : tab === 'reservations' ? 'Plan ahead, switch things up, or make room for another player.' : tab === 'students' ? 'Manage student access and keep everyone in the game.' : 'Reserve space for maintenance, campus events, and a little care.'}</p></div><div className="campus-badge"><MapPin size={16} /><div>RABAT CAMPUS<span>Sports complex · 2 courts</span></div></div></div>
        {notice && <div className="toast" role="status"><Check size={17} />{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
        {error && <div className="alert error" role="alert">{error}<button className="text-button" onClick={() => refresh()}>Try again</button></div>}

        {tab === 'courts' && <>
          <section className="hero-card"><div className="hero-copy"><span className="hero-tag"><span className="live-dot" /> A LITTLE COMPETITION. A LOT OF GOOD ENERGY.</span><h2>Clock out of class.<br />Step onto the court.</h2><p>Your weekly hour is waiting. Bring your racket,<br className="desktop-only" /> grab a friend, and make it count.</p><a href="#schedule" className="hero-link">Find your slot <ArrowDown size={16} /></a></div><div className="hero-art" aria-hidden="true"><div className="court-art"><div className="court-half top" /><div className="court-half bottom" /><div className="court-net" /></div><div className="padel-ball"><span /></div><div className="hero-art-label">PLAY MORE. FEEL BETTER.</div><span className="art-plus plus-one">+</span><span className="art-plus plus-two">+</span></div><div className="hero-number">01 / 02 <span>THE CAMPUS COLLECTION</span></div></section>
          <section className="stats-grid" aria-label="Booking overview"><div className="stat-card"><span className="stat-icon"><CalendarDays size={21} /></span><div><span className="stat-label">{admin ? 'Upcoming reservations' : 'Your weekly allowance'}</span><strong>{admin ? `${upcoming.length} reservations` : myWeekly ? '1 / 1 hour booked' : '1 hour to make yours'}</strong></div><span className={`stat-pill ${myWeekly ? 'neutral' : ''}`}>{admin ? 'Across both courts' : myWeekly ? 'Booked' : 'Ready to play'}</span></div><div className="stat-card"><span className="stat-icon"><LayoutGrid size={21} /></span><div><span className="stat-label">This week’s availability</span><strong>{availability ? `${availableCount} open slots` : 'Loading courts…'}</strong></div><span className="stat-detail">Across 2 courts</span></div><div className="stat-card"><span className="stat-icon"><Clock3 size={21} /></span><div><span className="stat-label">Court hours</span><strong>16:00 – 22:00</strong></div><span className="stat-detail">Mon – Fri</span></div></section>
          {nextBooking && <div className="upcoming-banner"><CalendarDays size={20} /><div><strong>{admin ? `${nextBooking.student_name} is up next` : 'You’re on the court next'}</strong><span>{nextBooking.court_name} · {dateLabel(nextBooking.date)} · {time(nextBooking.hour)}–{time(nextBooking.hour + 1)}</span></div><button className="text-button" onClick={() => setTab('reservations')}>View reservation <ArrowRight size={15} /></button></div>}
          <section id="schedule" className="schedule-section"><div className="section-heading"><div><span className="eyebrow">MAKE TIME FOR A MATCH</span><h2>Pick your court.</h2></div><span className="small-muted"><Clock3 size={14} /> All times in Morocco local time</span></div>
            <div className="schedule-card"><div className="schedule-toolbar"><div className="court-tabs" role="group" aria-label="Choose court">{[1, 2].map(id => <button key={id} className={court === id ? 'selected' : ''} onClick={() => setCourt(id)}><CourtMark small />Court {id}<span>OUTDOOR</span></button>)}</div><div className="week-label"><CalendarDays size={16} /><strong>{monday.toFormat('d MMM')} – {monday.plus({ days: 4 }).toFormat('d MMM yyyy')}</strong><span>This week</span></div></div>
              {editing && <div className="editing-banner"><Pencil size={16} /> Choose a new slot for {editing.student_name || 'your reservation'}.<button className="text-button" onClick={() => setEditing(null)}>Cancel change</button></div>}
              {!admin && myWeekly && !editing && <div className="quota-note"><Check size={15} /> Your hour this week is booked. You can reschedule it from My reservations.</div>}
              <div className="schedule-scroll" aria-busy={refreshing}><div className="calendar-grid"><div className="calendar-corner">TIME <span>GMT{now.toFormat('Z')}</span></div>{days.map(day => <div key={day.toISODate()} className={`day-header ${day.hasSame(now, 'day') ? 'today' : ''}`}><span>{day.toFormat('ccc')}</span><strong>{day.toFormat('dd')}<small>{day.toFormat('MMM')}</small></strong>{day.hasSame(now, 'day') && <i />}</div>)}
                {Array.from({ length: 6 }, (_, i) => i + 16).map(hour => <React.Fragment key={hour}><div className="time-cell">{time(hour)}<span>{time(hour + 1)}</span></div>{days.map(day => {
                  const slot = availability?.slots.find(s => s.courtId === court && s.date === day.toISODate() && s.hour === hour);
                  const mine = reservations.some(r => r.student_id === user.id && r.status === 'confirmed' && r.court_id === court && r.date === day.toISODate() && r.hour === hour);
                  const state = slot?.state === 'available' && startTime(slot) <= now ? 'past' : slot?.state;
                  const canBook = state === 'available' && (admin || !myWeekly || !!editing);
                  return <div className="slot-cell" key={day.toISODate()}><button className={`slot ${mine ? 'mine' : state ?? 'loading'}`} disabled={!canBook} onClick={() => slot && pickSlot(slot)} title={slot?.reason ?? undefined} aria-label={`${day.toFormat('cccc d MMMM')}, ${time(hour)}, Court ${court}: ${mine ? 'your reservation' : state ?? 'loading'}`}>
                    {mine ? <><Check size={14} /><span>Your match</span></> : state === 'available' ? <><Plus size={14} /><span>Available</span></> : state === 'booked' ? <><span className="slot-dot" /><span>Booked</span></> : state === 'closed' ? <><Ban size={13} /><span>Closed</span></> : <span>—</span>}
                  </button></div>;
                })}</React.Fragment>)}
              </div></div><div className="schedule-footer"><div className="legend"><span><i className="available" /> Available</span><span><i className="booked" /> Booked</span><span><i className="mine" /> Your reservation</span><span><i className="closed" /> Closed</span></div><span>One slot. One hour. All yours.</span></div>
            </div>
          </section>
          <section className="good-to-know"><CircleHelp size={20} /><div><h3>A few things before you play</h3><p>One reservation per student, per week. Book for the current week and change or cancel anytime before your slot starts. Courts take a break on weekends.</p></div><span className="fair-tag">FAIR PLAY, ALWAYS.</span></section>
        </>}

        {tab === 'reservations' && <section className="data-card"><div className="data-heading"><div><h2>{admin ? 'All reservations' : 'My reservations'}</h2><p>{upcoming.length} upcoming · Cancelled reservations stay in your history.</p></div><button className="button primary" onClick={() => setTab('courts')}><Plus size={16} />Book a court</button></div>{!reservations.length ? <Empty title="Your next match is waiting." text="Choose an available slot to make your first reservation." /> : <div className="table-scroll"><table><thead><tr>{admin && <th>Student</th>}<th>Court</th><th>Date & time</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{reservations.map(r => { const future = startTime(r) > now; const active = r.status === 'confirmed'; return <tr key={r.id}>{admin && <td><strong>{r.student_name}</strong><small>{r.student_email}</small></td>}<td><div className="table-court"><CourtMark small />{r.court_name}</div></td><td><strong>{dateLabel(r.date)}</strong><small>{time(r.hour)} – {time(r.hour + 1)}</small></td><td><span className={`status-pill ${active && future ? 'confirmed' : ''}`}>{!active ? 'Cancelled' : future ? 'Confirmed' : 'Completed'}</span></td><td><div className="table-actions">{active && future && <button className="text-button" onClick={() => { setEditing(r); setCourt(r.court_id); setTab('courts'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Reschedule</button>}{active && (future || admin) && <button className="text-button danger" onClick={() => setCancelling(r)}>Cancel</button>}</div></td></tr>; })}</tbody></table></div>}</section>}

        {tab === 'students' && admin && <section className="data-card"><div className="data-heading"><div><h2>Student directory</h2><p>{students.filter(s => s.active).length} active students · Accounts are managed by administrators.</p></div><button className="button primary" onClick={() => setStudentModal('new')}><Plus size={16} />Add student</button></div>{!students.length ? <Empty title="Room for everyone." text="Add a student to get started." /> : <div className="table-scroll"><table><thead><tr><th>Student</th><th>Email</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{students.map(s => <tr key={s.id}><td><strong>{s.name}</strong></td><td>{s.email}</td><td><span className={`status-pill ${s.active ? 'confirmed' : ''}`}>{s.active ? 'Active' : 'Inactive'}</span></td><td><button className="text-button" onClick={() => setStudentModal(s)}><Pencil size={14} />Edit student</button></td></tr>)}</tbody></table></div>}</section>}

        {tab === 'closures' && admin && <section className="data-card"><div className="data-heading"><div><h2>Court closures</h2><p>Block hourly slots for maintenance and events.</p></div><button className="button primary" onClick={() => setClosureModal(true)}><Plus size={16} />Add closure</button></div>{!closures.length ? <Empty title="All clear on the courts." text="No maintenance or events are scheduled." /> : <div className="table-scroll"><table><thead><tr><th>Court</th><th>Date & time</th><th>Reason</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{closures.map(c => <tr key={c.id}><td>Court {c.court_id}</td><td><strong>{dateLabel(c.date)}</strong><small>{time(c.start_hour)} – {time(c.end_hour)}</small></td><td>{c.reason}</td><td><button className="text-button danger" onClick={() => setRemovingClosure(c)}>Remove closure</button></td></tr>)}</tbody></table></div>}</section>}
        <footer className="page-footer"><span>UIR PADEL <i /> A little closer to your next match.</span><span>Made for campus life.</span></footer>
      </main>
    </div>

    {selected && <Modal title={editing ? 'A new time to play.' : 'Make this hour yours.'} subtitle="One court, one hour. A well-deserved break." onClose={() => !busy && setSelected(null)}><div className="booking-summary"><CourtMark /><div><strong>Court {selected.courtId}</strong><span>{dateLabel(selected.date, 'cccc, d MMMM yyyy')}</span><span>{time(selected.hour)} – {time(selected.hour + 1)} · Morocco time</span></div></div><form onSubmit={event => { event.preventDefault(); mutate(() => api(editing ? `/reservations/${editing.id}` : '/reservations', editing ? 'PATCH' : 'POST', { courtId: selected.courtId, date: selected.date, hour: selected.hour, ...(admin && !editing ? { studentId } : {}) }), editing ? 'Your reservation has been rescheduled.' : 'Court booked. See you out there!', closeBooking); }}>
      {admin && !editing && <label>Reserve for a student<select required value={studentId} onChange={e => setStudentId(e.target.value)}><option value="">Select a student</option>{students.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name} · {s.email}</option>)}</select></label>}
      <p className="form-note"><ShieldCheck size={16} /> This uses the student’s one-hour allowance for this week. Changes are allowed until the reservation starts.</p>{modalError && <div className="alert error" role="alert">{modalError}</div>}<button className="button primary wide" disabled={busy}>{busy ? 'Saving…' : editing ? 'Confirm new time' : 'Confirm reservation'}<ArrowRight size={17} /></button></form></Modal>}

    {cancelling && <Modal title="Make room for another match?" subtitle={`${cancelling.court_name} · ${dateLabel(cancelling.date)} · ${time(cancelling.hour)}`} onClose={() => !busy && setCancelling(null)}><p>Cancelling releases the slot and the student’s weekly allowance. The reservation will stay in the history.</p>{modalError && <div className="alert error" role="alert">{modalError}</div>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setCancelling(null)}>Keep reservation</button><button className="button destructive" disabled={busy} onClick={() => mutate(() => api(`/reservations/${cancelling.id}`, 'DELETE'), 'Reservation cancelled. The slot is available again.', () => setCancelling(null))}>{busy ? 'Cancelling…' : 'Cancel reservation'}</button></div></Modal>}

    {studentModal && <StudentForm student={studentModal} busy={busy} error={modalError} onClose={() => !busy && setStudentModal(null)} onSave={data => mutate(() => api(studentModal === 'new' ? '/admin/students' : `/admin/students/${studentModal.id}`, studentModal === 'new' ? 'POST' : 'PATCH', data), studentModal === 'new' ? 'Student added. Ready to play.' : 'Student account updated.', () => setStudentModal(null))} />}

    {closureModal && <Modal title="Give the court a break." subtitle="Closures must cover available future weekday slots. Cancel any overlapping reservations first." onClose={() => !busy && setClosureModal(false)}><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); mutate(() => api('/admin/closures', 'POST', { courtId: Number(data.get('courtId')), date: data.get('date'), startHour: Number(data.get('startHour')), endHour: Number(data.get('endHour')), reason: data.get('reason') }), 'Court closure added.', () => setClosureModal(false)); }}><div className="form-row"><label>Court<select name="courtId"><option value="1">Court 1</option><option value="2">Court 2</option></select></label><label>Date<input name="date" type="date" required min={now.toISODate()!} defaultValue={now.toISODate()!} /></label></div><div className="form-row"><label>Start<select name="startHour">{[16,17,18,19,20,21].map(h => <option key={h} value={h}>{time(h)}</option>)}</select></label><label>End<select name="endHour">{[17,18,19,20,21,22].map(h => <option key={h} value={h}>{time(h)}</option>)}</select></label></div><label>Reason<input name="reason" minLength={3} maxLength={200} placeholder="e.g. Court surface maintenance" required /></label>{modalError && <div className="alert error" role="alert">{modalError}</div>}<button className="button primary wide" disabled={busy}>{busy ? 'Saving…' : 'Add closure'}<Ban size={16} /></button></form></Modal>}
    {removingClosure && <Modal title="Open the court again?" subtitle={`Court ${removingClosure.court_id} · ${dateLabel(removingClosure.date)} · ${time(removingClosure.start_hour)}–${time(removingClosure.end_hour)}`} onClose={() => !busy && setRemovingClosure(null)}><p>Removing this closure makes its future slots available for reservations.</p>{modalError && <div className="alert error" role="alert">{modalError}</div>}<button className="button primary wide" disabled={busy} onClick={() => mutate(() => api(`/admin/closures/${removingClosure.id}`, 'DELETE'), 'Closure removed. The court is open again.', () => setRemovingClosure(null))}>{busy ? 'Removing…' : 'Remove closure'}</button></Modal>}
  </div>;
}

function StudentForm({ student, busy, error, onClose, onSave }: { student: Student | 'new'; busy: boolean; error: string; onClose: () => void; onSave: (data: unknown) => void }) {
  const isNew = student === 'new';
  return <Modal title={isNew ? 'Welcome a new player.' : 'Update student account.'} subtitle={isNew ? 'Create their account and share the credentials with them.' : 'Deactivation preserves history. Cancel future reservations first.'} onClose={onClose}><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); onSave({ name: data.get('name'), email: data.get('email'), ...(data.get('password') ? { password: data.get('password') } : {}), ...(!isNew ? { active: data.get('active') === 'on' } : {}) }); }}><label>Full name<input name="name" defaultValue={isNew ? '' : student.name} minLength={2} maxLength={100} required /></label><label>Email<input name="email" type="email" defaultValue={isNew ? '' : student.email} maxLength={200} required /></label><label>{isNew ? 'Password' : 'New password (leave blank to keep current)'}<input name="password" type="password" minLength={8} maxLength={72} autoComplete="new-password" required={isNew} /></label>{!isNew && <label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={student.active} />Account active</label>}{error && <div className="alert error" role="alert">{error}</div>}<button className="button primary wide" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create student account' : 'Save changes'}<Check size={17} /></button></form></Modal>;
}
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><CourtMark /><h3>{title}</h3><p>{text}</p></div>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
