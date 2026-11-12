// CampusConnect kinetic ribbon: original SVG SMIL, CSS layers and lifecycle handling.
import { useEffect, useRef, useState } from 'react';

export function AuthRibbon() {
  const artworkRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [motionPaused, setMotionPaused] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    let onScreen = true;
    const updateMotion = () => setMotionPaused(document.visibilityState === 'hidden' || !onScreen);
    const handleVisibility = () => updateMotion();
    document.addEventListener('visibilitychange', handleVisibility);

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              onScreen = entry?.isIntersecting ?? true;
              updateMotion();
            },
            { threshold: 0.05 },
          );
    if (artworkRef.current) observer?.observe(artworkRef.current);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(query.matches);
    query.addEventListener('change', updatePreference);
    return () => query.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (motionPaused || reducedMotion) svgRef.current?.pauseAnimations?.();
    else svgRef.current?.unpauseAnimations?.();
  }, [motionPaused, reducedMotion]);

  return (
    <div
      ref={artworkRef}
      aria-hidden="true"
      className={`cc-login-ribbon${motionPaused ? ' cc-login-ribbon--paused' : ''}`}
    >
      <span className="cc-login-ribbon-aura" />
      <svg ref={svgRef} focusable="false" viewBox="0 0 720 320">
        <defs>
          <linearGradient id="login-ribbon-primary" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#818cf8" />
            <stop offset="0.5" stopColor="#6366f1" />
            <stop offset="1" stopColor="#4338ca" />
          </linearGradient>
          <linearGradient id="login-ribbon-secondary" x1="0" x2="1">
            <stop offset="0" stopColor="#c4b5fd" stopOpacity="0.28" />
            <stop offset="0.55" stopColor="#8b5cf6" stopOpacity="0.82" />
            <stop offset="1" stopColor="#67e8f9" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="login-ribbon-light" x1="0" x2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.48" stopColor="#ffffff" stopOpacity="0.62" />
            <stop offset="1" stopColor="#a5f3fc" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g className="cc-login-ribbon-depth cc-login-ribbon-depth--back">
          <g className="cc-login-ribbon-layer cc-login-ribbon-layer--back">
            <path d="M54 229C151 279 226 259 296 176C379 79 472 60 666 122C511 111 432 144 361 225C285 312 176 302 54 229Z">
              {!reducedMotion ? (
                <animate
                  attributeName="d"
                  calcMode="spline"
                  dur="12s"
                  keySplines="0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1"
                  keyTimes="0;0.34;0.68;1"
                  repeatCount="indefinite"
                  values="M54 229C151 279 226 259 296 176C379 79 472 60 666 122C511 111 432 144 361 225C285 312 176 302 54 229Z;M54 218C154 294 238 270 304 171C383 54 487 73 666 136C518 113 438 132 356 218C276 302 169 288 54 218Z;M54 238C145 258 214 252 288 184C371 107 466 54 666 111C503 121 427 156 368 232C292 330 185 306 54 238Z;M54 229C151 279 226 259 296 176C379 79 472 60 666 122C511 111 432 144 361 225C285 312 176 302 54 229Z"
                />
              ) : null}
            </path>
          </g>
        </g>
        <g className="cc-login-ribbon-depth cc-login-ribbon-depth--middle">
          <g className="cc-login-ribbon-layer cc-login-ribbon-layer--main">
            <path d="M45 201C162 94 259 74 352 145C436 209 514 221 675 147C558 262 437 282 337 208C248 142 164 147 45 201Z">
              {!reducedMotion ? (
                <animate
                  attributeName="d"
                  calcMode="spline"
                  dur="9s"
                  keySplines="0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1"
                  keyTimes="0;0.33;0.67;1"
                  repeatCount="indefinite"
                  values="M45 201C162 94 259 74 352 145C436 209 514 221 675 147C558 262 437 282 337 208C248 142 164 147 45 201Z;M45 213C151 119 248 59 346 132C444 205 527 242 675 135C567 242 449 298 342 218C245 145 157 166 45 213Z;M45 187C174 72 274 91 359 157C430 212 501 199 675 158C548 281 425 269 332 197C254 137 171 128 45 187Z;M45 201C162 94 259 74 352 145C436 209 514 221 675 147C558 262 437 282 337 208C248 142 164 147 45 201Z"
                />
              ) : null}
            </path>
          </g>
        </g>
        <g className="cc-login-ribbon-depth cc-login-ribbon-depth--middle">
          <g className="cc-login-ribbon-layer cc-login-ribbon-layer--fold">
            <path d="M169 221C252 133 312 113 381 151C445 187 500 187 585 142C508 225 420 247 347 207C286 173 235 177 169 221Z">
              {!reducedMotion ? (
                <animate
                  attributeName="d"
                  calcMode="spline"
                  dur="11s"
                  keySplines="0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1"
                  keyTimes="0;0.36;0.7;1"
                  repeatCount="indefinite"
                  values="M169 221C252 133 312 113 381 151C445 187 500 187 585 142C508 225 420 247 347 207C286 173 235 177 169 221Z;M169 214C245 151 307 101 384 143C449 179 507 203 585 151C517 239 426 257 344 213C281 179 226 181 169 214Z;M169 229C260 116 321 126 377 160C439 198 493 171 585 134C497 214 414 236 351 201C290 167 242 171 169 229Z;M169 221C252 133 312 113 381 151C445 187 500 187 585 142C508 225 420 247 347 207C286 173 235 177 169 221Z"
                />
              ) : null}
            </path>
          </g>
        </g>
        <g className="cc-login-ribbon-depth cc-login-ribbon-depth--front">
          <path
            className="cc-login-ribbon-highlight"
            d="M78 194C178 113 263 101 350 159C438 217 521 214 641 158"
            pathLength="100"
          >
            {!reducedMotion ? (
              <animate
                attributeName="d"
                calcMode="spline"
                dur="6.5s"
                keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
                keyTimes="0;0.5;1"
                repeatCount="indefinite"
                values="M78 194C178 113 263 101 350 159C438 217 521 214 641 158;M78 205C167 128 257 85 350 148C448 214 530 235 641 147;M78 194C178 113 263 101 350 159C438 217 521 214 641 158"
              />
            ) : null}
          </path>
        </g>
      </svg>
    </div>
  );
}
