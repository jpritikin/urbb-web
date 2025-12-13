import { Cloud } from './cloudShape.js';

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface CloudInstance {
    cloud: Cloud;
    position: Vec3;
    velocity: Vec3;
}
