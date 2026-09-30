import { useEffect, useRef } from "react";
import {
  MAX_DISPLAY_KMH,
  MAX_DISPLAY_RPM,
  REDLINE_DISPLAY_RPM,
  telemetry,
} from "./telemetry";

// Dial geometry (SVG units). Angles are degrees clockwise from 12 o'clock.
const CENTER = 100;
const START_ANGLE = -135;
const SWEEP = 270;
const TICK_RADIUS = 78;
const LABEL_RADIUS = 60;
const RPM_RADIUS = 92;

function polar(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.sin(rad),
    y: CENTER - radius * Math.cos(rad),
  };
}

function arcPath(fromAngle: number, toAngle: number, radius: number) {
  const from = polar(fromAngle, radius);
  const to = polar(toAngle, radius);
  const largeArc = toAngle - fromAngle > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${largeArc} 1 ${to.x} ${to.y}`;
}

const speedAngle = (kmh: number) =>
  START_ANGLE + (Math.min(kmh, MAX_DISPLAY_KMH) / MAX_DISPLAY_KMH) * SWEEP;

const TICKS = Array.from({ length: MAX_DISPLAY_KMH / 10 + 1 }, (_, i) => i * 10);
const RPM_ARC = arcPath(START_ANGLE, START_ANGLE + SWEEP, RPM_RADIUS);
const REDLINE_ARC = arcPath(
  START_ANGLE + (REDLINE_DISPLAY_RPM / MAX_DISPLAY_RPM) * SWEEP,
  START_ANGLE + SWEEP,
  RPM_RADIUS,
);

function Speedometer() {
  const root = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGGElement>(null);
  const rpmFill = useRef<SVGPathElement>(null);
  const speedText = useRef<HTMLSpanElement>(null);
  const gearText = useRef<HTMLSpanElement>(null);

  // Animate straight from telemetry each frame, no React re-renders.
  useEffect(() => {
    let frame = 0;
    let shownKmh = 0;
    let shownRpm = 0;

    const tick = () => {
      shownKmh += (telemetry.speedKmh - shownKmh) * 0.25;
      shownRpm += (telemetry.rpm - shownRpm) * 0.3;

      needle.current?.setAttribute(
        "transform",
        `rotate(${speedAngle(shownKmh)} ${CENTER} ${CENTER})`,
      );
      rpmFill.current?.setAttribute(
        "stroke-dasharray",
        `${Math.min(shownRpm / MAX_DISPLAY_RPM, 1)} 1`,
      );
      if (speedText.current) {
        speedText.current.textContent = String(Math.round(shownKmh));
      }
      if (gearText.current) {
        gearText.current.textContent = telemetry.gearLabel;
      }
      root.current?.classList.toggle("boosting", telemetry.boost);
      root.current?.classList.toggle(
        "redline",
        shownRpm >= REDLINE_DISPLAY_RPM,
      );

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="speedometer" ref={root} aria-hidden="true">
      <svg viewBox="0 0 200 200">
        <circle className="speedometer-face" cx={CENTER} cy={CENTER} r={98} />

        {/* Rev ring */}
        <path className="speedometer-rpm-track" d={RPM_ARC} />
        <path className="speedometer-rpm-redline" d={REDLINE_ARC} />
        <path
          ref={rpmFill}
          className="speedometer-rpm-fill"
          d={RPM_ARC}
          pathLength={1}
          strokeDasharray="0 1"
        />

        {/* Speed ticks and labels */}
        {TICKS.map((kmh) => {
          const angle = speedAngle(kmh);
          const major = kmh % 50 === 0;
          const outer = polar(angle, TICK_RADIUS);
          const inner = polar(angle, TICK_RADIUS - (major ? 10 : 5));
          return (
            <line
              key={kmh}
              className={major ? "speedometer-tick major" : "speedometer-tick"}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
            />
          );
        })}
        {TICKS.filter((kmh) => kmh % 50 === 0).map((kmh) => {
          const { x, y } = polar(speedAngle(kmh), LABEL_RADIUS);
          return (
            <text key={kmh} className="speedometer-label" x={x} y={y}>
              {kmh}
            </text>
          );
        })}

        {/* Needle (drawn pointing up, rotated into place) */}
        <g ref={needle} transform={`rotate(${START_ANGLE} ${CENTER} ${CENTER})`}>
          <polygon
            className="speedometer-needle"
            points={`${CENTER - 2.5},${CENTER + 12} ${CENTER},${CENTER - 80} ${CENTER + 2.5},${CENTER + 12}`}
          />
        </g>
        <circle className="speedometer-hub" cx={CENTER} cy={CENTER} r={7} />
      </svg>

      <div className="speedometer-readout">
        <span className="speedometer-speed" ref={speedText}>
          0
        </span>
        <span className="speedometer-unit">km/h</span>
        <span className="speedometer-gear" ref={gearText}>
          N
        </span>
      </div>
    </div>
  );
}

export default Speedometer;
