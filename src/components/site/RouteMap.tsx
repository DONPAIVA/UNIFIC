import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, CircleMarker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair } from "lucide-react";
import truck3d from "@/assets/truck-3d.png";

const BRAZIL_BOUNDS = L.latLngBounds([-34.2, -74.2], [5.6, -33.6]);

const truckIcon = (moving: boolean, flip: boolean) =>
  L.divIcon({
    className: "",
    html: `<div class="truck-3d ${moving ? "truck-3d--moving" : ""}" style="position:relative;width:66px;height:42px;${flip ? "transform:scaleX(-1);" : ""}">
      <img src="${truck3d}" alt="Caminhão de entrega" style="width:66px;height:auto;max-width:66px;filter:drop-shadow(0 4px 5px rgba(0,0,0,.45));" />
      <span class="truck-3d__shadow"></span>
    </div>`,
    iconSize: [66, 42],
    iconAnchor: [33, 34],
  });

type Pt = [number, number];

type Props = {
  from: Pt;
  to: Pt;
  progress: number;
  fromLabel: string;
  toLabel: string;
  moving?: boolean;
  eta?: string;
};

function useRoadRoute(from: Pt, to: Pt) {
  const [route, setRoute] = useState<Pt[] | null>(null);
  useEffect(() => {
    let alive = true;
    setRoute(null);
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        const coords = j?.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined;
        if (alive && coords?.length) setRoute(coords.map(([lng, lat]) => [lat, lng] as Pt));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [from[0], from[1], to[0], to[1]]);
  return route ?? [from, to];
}

function dist(a: Pt, b: Pt) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function pointOnPath(path: Pt[], pct: number): { pos: Pt; flip: boolean } {
  if (path.length < 2) return { pos: path[0] ?? [0, 0], flip: false };
  const segs = path.slice(1).map((p, i) => dist(path[i]!, p));
  const total = segs.reduce((a, b) => a + b, 0);
  let target = (Math.max(0, Math.min(100, pct)) / 100) * total;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (target <= s || i === segs.length - 1) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const t = s === 0 ? 0 : Math.min(1, target / s);
      return { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], flip: b[1] < a[1] };
    }
    target -= s;
  }
  return { pos: path[path.length - 1]!, flip: false };
}

function splitPath(path: Pt[], pos: Pt, pct: number) {
  const idx = Math.max(1, Math.round((pct / 100) * (path.length - 1)));
  return { done: [...path.slice(0, idx), pos] as Pt[], rest: [pos, ...path.slice(idx)] as Pt[] };
}

function MapBehavior({ path, truck, to, follow, arrived, userInteracted }: {
  path: Pt[];
  truck: Pt;
  to: Pt;
  follow: boolean;
  arrived: boolean;
  userInteracted: boolean;
}) {
  const map = useMap();
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Se o usuário interagiu, NÃO force ajustes (a menos que "follow" esteja ativo)
    if (userInteracted && !follow) return;

    if (follow) {
      map.flyTo(truck, 13, { duration: 0.8 });
      return;
    }
    if (arrived) {
      map.flyTo(to, 13, { duration: 0.8 });
      return;
    }
    if (!hasInitialized.current && path.length > 1) {
      map.fitBounds(L.latLngBounds(path.map((p) => L.latLng(p[0], p[1]))), { padding: [40, 40] });
      hasInitialized.current = true;
    }
  }, [follow, arrived, map, path, truck, to, userInteracted]);

  return null;
}

export default function RouteMap({ from, to, progress, fromLabel, toLabel, moving = true }: Props) {
  const [follow, setFollow] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const userInteractedRef = useRef(false);

  const path = useRoadRoute(from, to);
  const { pos: truck, flip } = useMemo(() => pointOnPath(path, progress), [path, progress]);
  const { done, rest } = useMemo(() => splitPath(path, truck, progress), [path, truck, progress]);
  const arrived = progress >= 99;

  const handleFollowToggle = () => {
    const newFollow = !follow;
    setFollow(newFollow);
    if (newFollow) {
      // Ao ativar "seguir", resetamos a interação para forçar centralização
      userInteractedRef.current = false;
      setUserInteracted(false);
    }
  };

  const MapInteractionHandler = () => {
    const map = useMap();
    useEffect(() => {
      const onInteraction = () => {
        if (!userInteractedRef.current) {
          userInteractedRef.current = true;
          setUserInteracted(true);
        }
      };
      map.on("zoomstart", onInteraction);
      map.on("movestart", onInteraction);
      return () => {
        map.off("zoomstart", onInteraction);
        map.off("movestart", onInteraction);
      };
    }, [map]);
    return null;
  };

  return (
    <div className="relative">
      <div className="pointer-events-none absolute right-2 top-2 z-[400] flex gap-1.5">
        <button
          type="button"
          onClick={handleFollowToggle}
          className={`pointer-events-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold shadow ${
            follow ? "bg-primary text-primary-foreground" : "bg-white/95 text-slate-800"
          }`}
        >
          <Crosshair className="h-3 w-3" /> {follow ? "Seguindo carga" : "Acompanhar de perto"}
        </button>
      </div>

      <MapContainer
        center={to}
        zoom={5}
        minZoom={4}
        maxBounds={BRAZIL_BOUNDS}
        maxBoundsViscosity={1}
        scrollWheelZoom={true}   // ← PERMITE ZOOM COM A RODA
        attributionControl={false}
        className="h-72 w-full sm:h-[26rem]"
      >
        <MapInteractionHandler />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" bounds={BRAZIL_BOUNDS} maxZoom={19} />
        <MapBehavior path={path} truck={truck} to={to} follow={follow} arrived={arrived} userInteracted={userInteracted} />
        <Polyline positions={done} pathOptions={{ color: "#f5b400", weight: 5, opacity: 0.95 }} />
        <Polyline positions={rest} pathOptions={{ color: "#1f2937", weight: 3, opacity: 0.6, dashArray: "8 10" }} />
        <CircleMarker center={from} radius={7} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#0f172a", fillOpacity: 1 }}>
          <Tooltip direction="top">Origem: {fromLabel}</Tooltip>
        </CircleMarker>
        <CircleMarker center={to} radius={8} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#f5b400", fillOpacity: 1 }}>
          <Tooltip direction="top" permanent>
            Destino: {toLabel}
          </Tooltip>
        </CircleMarker>
        <Marker position={truck} icon={truckIcon(moving, flip)} zIndexOffset={500}>
          {/* Só anuncia movimento quando há movimento: com a carga parada, o
              texto fixo entregaria que algo foi congelado. */}
          <Popup>
            {moving ? "Carga em movimento" : "Carga"} — {progress.toFixed(1)}% do trajeto
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}