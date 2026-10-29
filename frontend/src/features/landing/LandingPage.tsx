import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { capabilities, journey, safetyDisclaimer } from './landing-content';

// CampusConnect ContentVisual geometry, using its existing shared SVG icons.
function FeatureVisual({ icon, compact = false }: { readonly icon: IconName; readonly compact?: boolean }) {
  return <div aria-hidden="true" className={`cc-content-visual${compact ? ' cc-content-visual--compact' : ''}`}><span className="cc-visual-grid" /><Icon name={icon} />{compact ? null : <span className="cc-visual-caption">Interface illustration</span>}</div>;
}

// CampusConnect ProductPreview composition without highlights, records, timers or services.
function ProductPreview() {
  return <div className="cc-product-canvas" role="region" aria-label="Illustrative MedDecode workspace">
    <header className="cc-canvas-chrome"><span className="cc-canvas-logo" aria-hidden="true">M</span><span className="cc-canvas-workspace">Your medicine workspace</span><span className="cc-canvas-search"><Icon name="dashboard" />Concept preview</span></header>
    <div className="cc-canvas-body"><div className="cc-canvas-intro"><div><small className="cc-record-label">Clarity, in one place</small><h2>From prescription to understanding.</h2></div><Icon name="copy" /></div>
      <article className="cc-canvas-feature"><FeatureVisual icon="copy" /><div className="cc-feature-copy"><small className="cc-record-label">Illustrative interface · Planned feature</small><h3>Prescription Understanding</h3><p>A clearer place for prescription details and medicine information.</p><div className="cc-record-tags"><span>Image or PDF</span><span>Organized details</span></div><span className="md-preview-note">No prescription data shown</span></div></article>
      <div className="cc-canvas-side">{capabilities.filter((item) => ['Medicine Insights', 'Medicine Cabinet'].includes(item.title)).map((item) => <article className="cc-canvas-match" key={item.title}><FeatureVisual icon={item.icon} compact /><div><small className="cc-record-label">Planned capability</small><strong>{item.title}</strong><p>{item.title === 'Medicine Insights' ? 'Explore available medicine information.' : 'Keep medicine information organized.'}</p></div><Icon name="arrow" /></article>)}</div>
    </div><footer className="cc-canvas-footer"><span><Icon name="copy" />Static illustration · No medical analysis</span><span>Product features are not yet available</span></footer>
  </div>;
}

// CampusConnect PlatformShowcase selector/frame; six neutral capability illustrations.
function Capabilities() {
  const [selectedIndex, select] = useState(0);
  const selected = capabilities[selectedIndex];
  return <section className="cc-chapter cc-platform-showcase" data-landing-reveal id="product" tabIndex={-1} aria-labelledby="features-title">
    <header className="cc-chapter-heading"><p className="cc-landing-eyebrow">Planned capabilities</p><h2 id="features-title">Useful tools. One clearer medicine journey.</h2><p>These capabilities describe the intended product. They are not available in this frontend preview.</p></header>
    <div className="cc-showcase-layout"><div className="cc-showcase-selector" role="group" aria-label="Explore planned capabilities">{capabilities.map((item, index) => <button type="button" className="cc-showcase-option" key={item.title} aria-pressed={index === selectedIndex} aria-controls="landing-module-scene" onClick={() => select(index)}><span><Icon name={item.icon} /></span><span><strong>{item.title}</strong><small>{item.description}</small></span><Icon className="cc-showcase-arrow" name="arrow" /></button>)}</div>
    <div className="cc-showcase-stage" id="landing-module-scene" aria-live="polite" aria-atomic="true"><div className="cc-module-frame"><header><span><Icon name={selected.icon} />MedDecode · {selected.title}</span><i /><i /><i /></header><div className="md-capability-scene"><span className="cc-record-label">Concept illustration · No medicine data</span><FeatureVisual icon={selected.icon} /><h3>{selected.title}</h3><p>{selected.description}</p><ul>{selected.labels.map((label) => <li key={label}><Icon name="chevron" />{label}</li>)}</ul><p className="md-preview-note">Planned feature · Not yet implemented</p></div></div></div></div>
  </section>;
}

export function LandingPage() {
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = page.current;
    if (!root || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Source one-shot reveal: content is visible before observation and without JS motion.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('cc-reveal-visible'); observer.unobserve(entry.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    root.querySelectorAll('[data-landing-reveal]').forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);
  return <div ref={page}>
    <section className="cc-landing-hero cc-chapter cc-chapter--intro" aria-labelledby="hero-title">
      <div className="cc-landing-hero-copy"><p className="cc-landing-eyebrow">Intelligence Behind Every Prescription</p><h1 id="hero-title">Understand your prescriptions. Know your medicines.</h1><p className="cc-landing-lead">MedDecode helps you make sense of prescriptions, explore medicine information, compare formulations and manage your medicines in one place.</p><div className="cc-landing-hero-actions"><Link className="cc-landing-button cc-landing-button--primary" to="/get-started">Get Started <Icon name="arrow" /></Link><Link className="cc-landing-button cc-landing-button--secondary" to="/#product">Explore Features</Link></div><p className="cc-landing-assurance"><span>Informational guidance</span><span>Planned product experience</span><span>Professional advice matters</span></p></div>
      <div className="cc-hero-canvas-wrap"><ProductPreview /></div>
    </section>
    <Capabilities />
    <section className="cc-chapter cc-student-journey" data-landing-reveal id="how-it-works" tabIndex={-1} aria-labelledby="journey-title"><header className="cc-landing-section-heading cc-landing-section-heading--center"><p className="cc-landing-eyebrow">How MedDecode is designed to work</p><h2 id="journey-title">Three steps toward a clearer picture.</h2><p>An intended workflow, shown here as a product overview.</p></header><ol className="cc-journey-steps">{journey.map((step, index) => <li key={step.title}><div className="cc-journey-marker"><span>{String(index + 1).padStart(2, '0')}</span><Icon name={step.icon} /></div><h3>{step.title}</h3><p>{step.description}</p><div aria-hidden="true" className="cc-journey-fragment"><Icon name={step.icon} /><span>{step.fragment}</span><Icon name="arrow" /></div></li>)}</ol></section>
    <section className="cc-chapter cc-trust-section" data-landing-reveal id="trust" tabIndex={-1} aria-labelledby="trust-title"><header className="cc-landing-section-heading"><p className="cc-landing-eyebrow">Clarity with care</p><h2 id="trust-title">Information to understand. Decisions with a professional.</h2><p>{safetyDisclaimer}</p></header><div className="cc-trust-grid">{[
      { icon: 'copy' as const, title: 'Information, with context', description: 'Available information can help you prepare questions for a qualified professional.' },
      { icon: 'profile' as const, title: 'Your care stays with professionals', description: 'MedDecode does not diagnose, prescribe or autonomously change medication.' },
      { icon: 'search' as const, title: 'Availability is made clear', description: 'An unavailable source or feature must not be presented as a verified result.' },
      { icon: 'bookmark' as const, title: 'Room to keep learning', description: 'Learn & Resources is planned to support the medicine journey with educational material.' },
    ].map((item) => <article key={item.title}><span><Icon name={item.icon} /></span><div><h3>{item.title}</h3><p>{item.description}</p></div></article>)}</div></section>
    <section className="cc-chapter cc-landing-cta" data-landing-reveal aria-labelledby="closing-title"><p className="cc-landing-eyebrow">Your medicine journey, made clearer</p><h2 id="closing-title">Start with understanding.</h2><p>Explore the MedDecode preview. Account access is coming in the next phase.</p><div className="cc-landing-cta-actions"><Link className="cc-landing-button cc-landing-button--primary" to="/get-started">Get Started <Icon name="arrow" /></Link><Link className="cc-landing-signin" to="/sign-in"><strong>Sign In</strong></Link></div><div aria-hidden="true" className="cc-cta-sequence"><span><Icon name="copy" />Understand</span><i /><span><Icon name="search" />Explore</span><i /><span><Icon name="briefcase" />Organize</span></div></section>
  </div>;
}
