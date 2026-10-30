import { Link } from 'react-router-dom';
import { Badge, Card, SectionHeader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { destinations } from '../../app/navigation';
import { DemoPage, DemoLink } from './DemoShared';
import { useDemo } from './demo-context';
import { prescriptions } from './demo-data';

export function HomePage() {
  const { cabinet, reminders } = useDemo();
  const upcoming = reminders.filter(item => item.enabled).sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return <DemoPage title="Home" description="A clearer view of your medicine workspace.">
    <section className="cc-home-welcome"><div className="cc-home-welcome-copy"><p className="cc-home-kicker"><span /> YOUR DEMO WORKSPACE</p><h2>Welcome back, <span>Demo User.</span></h2><p>Explore prescription examples, organize a cabinet and discover how MedDecode fits together.</p></div><DemoLink to="/upload-prescription">Explore a sample</DemoLink></section>
    <div className="md-demo-stats">{[{ label: 'Example prescriptions', value: prescriptions.length, icon: 'inbox' as const }, { label: 'Cabinet entries', value: cabinet.length, icon: 'briefcase' as const }, { label: 'Enabled reminders', value: upcoming.length, icon: 'bell' as const }].map(item => <Card key={item.label} className="md-demo-stat"><span className="cc-explore-icon"><Icon name={item.icon} /></span><div><p>{item.label}</p><strong>{item.value.toString().padStart(2,'0')}</strong><small>For this demonstration</small></div></Card>)}</div>
    <div className="md-demo-two"><Card className="md-demo-panel"><SectionHeader title="Your prescription examples" description="Predefined documents. No patient records." actions={<Link className="md-demo-text-link" to="/upload-prescription">View sample <Icon name="arrow" className="size-4" /></Link>} />{prescriptions.map(item => <Link to="/upload-prescription" className="md-demo-row" key={item.id}><span className="cc-explore-icon"><Icon name="inbox" /></span><div><strong>{item.title}</strong><small>{item.id} · {item.date}</small></div><Badge>{item.count} example entries</Badge></Link>)}</Card>
    <Card className="md-demo-panel"><SectionHeader title="Coming up" description="Illustrative organization tasks; no notifications sent." />{upcoming.length ? upcoming.slice(0,3).map(item => <Link to="/reminders" className="md-demo-row" key={item.id}><span className="cc-explore-icon"><Icon name="calendar" /></span><div><strong>{item.title}</strong><small>{item.date} · {item.time}</small></div><Icon name="chevron" className="size-4" /></Link>) : <p className="md-demo-muted">No enabled example reminders.</p>}<DemoLink to="/reminders" secondary>Manage reminders</DemoLink></Card></div>
    <section><SectionHeader title="Start something useful" description="One workspace, six ways to explore." /><div className="md-demo-actions">{destinations.slice(1).map(item => <Link className="cc-card md-demo-action" to={item.path} key={item.path}><span className="cc-explore-icon"><Icon name={item.icon} /></span><strong>{item.label}</strong><Icon name="arrow" className="size-4" /></Link>)}</div></section>
    <Card className="md-demo-panel"><SectionHeader title="Recent example activity" /><ol className="md-demo-activity"><li><span className="md-demo-dot" />Example document added to the demonstration<span>Sample activity</span></li><li><span className="md-demo-dot" />Reference cards prepared for exploration<span>Sample activity</span></li></ol></Card>
  </DemoPage>;
}
