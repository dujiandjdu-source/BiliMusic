
/** MIT License github.com/pushkine/ */
export interface SpringParams {
	mass?: number; // = 1.0
	damping?: number; // = 10.0
	stiffness?: number; // = 100.0
	soft?: boolean; // = false
}

type seconds = number;

export function solve_spring(from: number, velocity: number, to: number, params: SpringParams) {
    // Defaults
    const p = {
        mass: params.mass ?? 1.0,
        damping: params.damping ?? 10.0,
        stiffness: params.stiffness ?? 100.0,
        soft: params.soft ?? false
    };

	const delta = to - from;
	if (true === p.soft || 1.0 <= p.damping / (2.0 * Math.sqrt(p.stiffness * p.mass))) {
		const angular_frequency = -Math.sqrt(p.stiffness / p.mass);
		const leftover = -angular_frequency * delta - velocity;
		return (t: seconds) => to - (delta + t * leftover) * Math.E ** (t * angular_frequency);
	} else {
		const damping_frequency = Math.sqrt(4.0 * p.mass * p.stiffness - p.damping ** 2.0);
		const leftover = (p.damping * delta - 2.0 * p.mass * velocity) / damping_frequency;
		const dfm = (0.5 * damping_frequency) / p.mass;
		const dm = -(0.5 * p.damping) / p.mass;
		return (t: seconds) => to - (Math.cos(t * dfm) * delta + Math.sin(t * dfm) * leftover) * Math.E ** (t * dm);
	}
}
