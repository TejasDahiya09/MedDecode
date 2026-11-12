import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { destinations } from '../../app/navigation';
import { useDemo } from './demo-context';
import { prescriptions } from './demo-data';
import './home-layout.css';

// Presentation adapted from CampusConnect Home: Welcome, Continue, QuickActions,
// Discover and ProfilePrompt. Only local MedDecode demo state is read here.
function Heading({ id, title, description, eyebrow }: { id: string; title: string; description: string; eyebrow?: string }) {
  return <div className="cc-home-section-heading"><div>{eyebrow && <p className="cc-home-section-eyebrow">{eyebrow}</p>}<h2 id={id}>{title}</h2><p>{description}</p></div></div>;
}
const kinds = ['marketplace','teamup','service','marketplace','lost_found','teamup'];
const actionDescriptions = ['View an example','Fictional references','Sample properties','Example entries','Local tasks only','Demo guides'];
const actionLabels = ['Upload a sample','Explore medicines','Compare examples','Open cabinet','Plan a reminder','Learn & resources'];
export function HomePage() {
  const { cabinet, reminders } = useDemo();
  const upcoming = reminders.filter(item => item.enabled).sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const activity = [
    { title:'Example document added', label:'Prescription example', path:'/upload-prescription', icon:'inbox' as const, kind:'marketplace' },
    { title:'Reference cards prepared', label:'Medicine insights', path:'/medicine-insights', icon:'search' as const, kind:'teamup' },
  ];
  return <div className="cc-home-page cc-home-page--continue md-home">
    <section className="cc-home-welcome"><div className="cc-home-welcome-copy"><p className="cc-home-kicker"><span /><span className="md-home-kicker-label">YOUR WORKSPACE</span><small className="md-home-badge">Demo Mode</small></p><h1>Welcome, <span>Demo User.</span></h1><p>Explore prescription examples, organize your cabinet and plan useful tasks.</p></div><Link className="cc-home-profile-link" to="/upload-prescription" aria-label="Explore a sample"><Icon name="inbox" className="size-4" /><span>Explore a sample</span><Icon name="arrow" className="size-4" /></Link></section>
    <div className="cc-home-primary-grid cc-home-primary-grid--continue">
      <section className="cc-home-continue is-primary" aria-labelledby="home-continue-title"><Heading id="home-continue-title" eyebrow="Your workspace" title="Your prescription examples" description="Return to predefined examples. No patient records." /><div className="cc-home-continue-list">{prescriptions.map(item => <Link to="/upload-prescription" className="cc-home-continue-item cc-home-kind--marketplace" key={item.id}><span className="cc-home-item-icon"><Icon name="inbox" className="size-5" /></span><span className="cc-home-item-copy"><strong>{item.title}</strong><small>{item.id} · {item.count} example entries · {item.date}</small></span><span className="cc-home-open-label">Open</span><Icon name="arrow" className="cc-home-row-arrow size-4" /></Link>)}</div></section>
      <section className="cc-home-continue md-home-reminders" aria-labelledby="home-reminders-title"><Heading id="home-reminders-title" eyebrow="Local tasks" title="Upcoming reminders" description="Local tasks. No notifications are sent." /><div className="cc-home-continue-list">{upcoming.length ? upcoming.slice(0,2).map(item => <Link className="cc-home-continue-item cc-home-kind--lost_found" key={item.id} to="/reminders"><span className="cc-home-item-icon"><Icon name="calendar" className="size-5" /></span><span className="cc-home-item-copy"><strong>{item.title}</strong><small>{item.date} at {item.time}</small></span><Icon name="arrow" className="cc-home-row-arrow size-4" /></Link>) : <p className="md-demo-muted">No enabled example reminders.</p>}</div></section>
    </div>
      <section className="cc-home-actions" aria-labelledby="home-actions-title"><Heading id="home-actions-title" title="Start something" description="Explore, compare, organize or learn." /><div className="cc-home-action-grid">{destinations.slice(1).map((item,index) => <Link key={item.path} to={item.path} aria-label={item.label} className={`cc-home-action-tile cc-home-kind--${kinds[index]}`}><span className="cc-home-action-icon"><Icon name={item.icon} className="size-5" /></span><span className="cc-home-action-copy"><strong>{actionLabels[index]}</strong><small>{actionDescriptions[index]}</small></span><Icon name="arrow" className="cc-home-action-arrow size-4" /></Link>)}</div></section>
    <section className="cc-home-discover" aria-labelledby="home-discover-title"><Heading id="home-discover-title" eyebrow="Sample activity" title="Discover your workspace" description="Illustrative activity, independent of your actions in this visit." /><div className="cc-home-discover-grid">{activity.map(item => <Link to={item.path} key={item.path} className={`cc-home-discover-card cc-home-kind--${item.kind}`}><span className="cc-home-discover-topline"><span className="cc-home-item-icon"><Icon name={item.icon} className="size-[1.125rem]" /></span><span>{item.label}</span></span><strong>{item.title}</strong><span className="cc-home-discover-action">View example <Icon name="arrow" className="size-4" /></span></Link>)}</div></section>
    <aside className="cc-home-profile-prompt" aria-labelledby="home-cabinet-title"><span className="md-home-cabinet-count" aria-label={`${cabinet.length} cabinet entries`}>{cabinet.length.toString().padStart(2,'0')}</span><div className="cc-home-profile-copy"><p className="cc-home-section-eyebrow">Your demo cabinet</p><h2 id="home-cabinet-title">Keep your examples organized</h2><p>Review the cabinet entries you manage in this visit.</p></div><Link className="cc-home-section-link" to="/my-cabinet">Open cabinet <Icon name="arrow" className="size-4" /></Link></aside>
    <p className="md-demo-footnote">Synthetic examples. No clinical validation. In-memory only · No account, cloud saving or background notifications.</p>
  </div>;
}
