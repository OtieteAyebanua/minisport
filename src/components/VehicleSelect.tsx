import { useEffect, useState, type CSSProperties } from "react";
import VehiclePreview from "./VehiclePreview";
import { VEHICLES, type VehicleId } from "./vehicles";

type VehicleSelectProps = {
  onSelect: (id: VehicleId) => void;
};

// Start screen: pick a vehicle. Click a card, press its number, or use ←/→ + Enter.
function VehicleSelect({ onSelect }: VehicleSelectProps) {
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") {
        setHighlighted((i) => (i + VEHICLES.length - 1) % VEHICLES.length);
      } else if (e.code === "ArrowRight" || e.code === "KeyD") {
        setHighlighted((i) => (i + 1) % VEHICLES.length);
      } else if (/^Digit[1-9]$/.test(e.code)) {
        const vehicle = VEHICLES[Number(e.code.slice(-1)) - 1];
        if (vehicle) onSelect(vehicle.id);
      } else if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        onSelect(VEHICLES[highlighted].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [highlighted, onSelect]);

  return (
    <div className="vehicle-select">
      <header className="vehicle-select-header">
        <p className="vehicle-select-eyebrow">Minisport</p>
        <h1>Choose your ride</h1>
      </header>

      <div className="vehicle-cards">
        {VEHICLES.map((vehicle, index) => {
          const active = index === highlighted;
          return (
            <button
              key={vehicle.id}
              type="button"
              className={active ? "vehicle-card active" : "vehicle-card"}
              style={{ "--card-accent": vehicle.accent } as CSSProperties}
              onMouseEnter={() => setHighlighted(index)}
              onFocus={() => setHighlighted(index)}
              onClick={() => onSelect(vehicle.id)}
            >
              <div className="vehicle-card-preview">
                <VehiclePreview
                  url={vehicle.modelUrl}
                  accent={vehicle.accent}
                  animation={vehicle.previewAnimation}
                  prepare={vehicle.prepareModel}
                  spinning={active}
                />
                <span className="vehicle-card-key">{index + 1}</span>
              </div>

              <div className="vehicle-card-body">
                <h2>{vehicle.name}</h2>
                <p className="vehicle-card-tagline">{vehicle.tagline}</p>

                <dl className="vehicle-stats">
                  {vehicle.stats.map((stat) => (
                    <div key={stat.label} className="vehicle-stat">
                      <dt>{stat.label}</dt>
                      <dd>
                        <span style={{ width: `${stat.value * 100}%` }} />
                      </dd>
                    </div>
                  ))}
                </dl>

                <ul className="vehicle-perks">
                  {vehicle.perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>

                <span className="vehicle-card-cta">
                  {active ? "Press Enter to drive" : "Select"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default VehicleSelect;
