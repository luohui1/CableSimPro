// The product library as the 8210 host holds it on 2026-11-16 (library.series, library.series.get for each series) and the
// workspace of YJV22-8.7/15 kV 3×240 version 3 as this branch's host (8212) holds it (library.spec.get
// s-89150e51.3x240), copied unchanged except its review, which follows the host since (submitted by 工程师, approved by
// 审核员): the same structure as version 1, which the versions page shows published.

export interface LibrarySpec {
  id: string; key: string; area: number; version: number; review: 'draft' | 'submitted' | 'reviewed' | 'published';
  od: number; r20: number | null; weight: number | null; ac: number | null; check: Record<string, number> | null;
  conductor?: number; insulation?: number; sheath?: number;
}
export interface LibrarySeries {
  id: string; name: string; manufacturer: string; designation: string; cores: number; u0_kv: number; u_kv: number;
  origin: string; standards: string[]; states: Record<string, number>; by: string; specs: LibrarySpec[];
}

export const LIBRARY: LibrarySeries[] = [
 {
  "id": "s-3382c86d",
  "name": "人民电缆集团 YJV22-8.7/15 kV 三芯",
  "manufacturer": "人民电缆集团",
  "designation": "YJV22",
  "cores": 3,
  "u0_kv": 8.7,
  "u_kv": 15.0,
  "origin": "public",
  "standards": [
   "GB/T 12706.2-2020",
   "GB/T 3956-2008"
  ],
  "states": {
   "draft": 11
  },
  "by": "Agent",
  "specs": [
   {
    "id": "s-3382c86d.3x25",
    "key": "3×25",
    "area": 25,
    "version": 1,
    "review": "draft",
    "od": 52.0,
    "r20": 0.727,
    "weight": 3164,
    "ac": 0.927128,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 6,
    "insulation": 4.5,
    "sheath": 2.5
   },
   {
    "id": "s-3382c86d.3x35",
    "key": "3×35",
    "area": 35,
    "version": 1,
    "review": "draft",
    "od": 54,
    "r20": 0.524,
    "weight": 4091,
    "ac": 0.668346,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 7,
    "insulation": 4.5,
    "sheath": 2.6
   },
   {
    "id": "s-3382c86d.3x50",
    "key": "3×50",
    "area": 50,
    "version": 1,
    "review": "draft",
    "od": 58.0,
    "r20": 0.387,
    "weight": 4715,
    "ac": 0.493745,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 8.1,
    "insulation": 4.5,
    "sheath": 2.7
   },
   {
    "id": "s-3382c86d.3x70",
    "key": "3×70",
    "area": 70,
    "version": 1,
    "review": "draft",
    "od": 62.0,
    "r20": 0.268,
    "weight": 5703,
    "ac": 0.342178,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 9.9,
    "insulation": 4.5,
    "sheath": 2.9
   },
   {
    "id": "s-3382c86d.3x95",
    "key": "3×95",
    "area": 95,
    "version": 1,
    "review": "draft",
    "od": 66.0,
    "r20": 0.193,
    "weight": 6728,
    "ac": 0.246771,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 11.5,
    "insulation": 4.5,
    "sheath": 3
   },
   {
    "id": "s-3382c86d.3x120",
    "key": "3×120",
    "area": 120,
    "version": 1,
    "review": "draft",
    "od": 69.0,
    "r20": 0.153,
    "weight": 7716,
    "ac": 0.195996,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 12.9,
    "insulation": 4.5,
    "sheath": 3.1
   },
   {
    "id": "s-3382c86d.3x150",
    "key": "3×150",
    "area": 150,
    "version": 1,
    "review": "draft",
    "od": 72.0,
    "r20": 0.124,
    "weight": 8859,
    "ac": 0.159289,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 14.3,
    "insulation": 4.5,
    "sheath": 3.2
   },
   {
    "id": "s-3382c86d.3x185",
    "key": "3×185",
    "area": 185,
    "version": 1,
    "review": "draft",
    "od": 76,
    "r20": 0.0991,
    "weight": 10257,
    "ac": 0.127917,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 16,
    "insulation": 4.5,
    "sheath": 3.3
   },
   {
    "id": "s-3382c86d.3x240",
    "key": "3×240",
    "area": 240,
    "version": 1,
    "review": "draft",
    "od": 82,
    "r20": 0.0754,
    "weight": 12371,
    "ac": 0.098314,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 18.4,
    "insulation": 4.5,
    "sheath": 3.5
   },
   {
    "id": "s-3382c86d.3x300",
    "key": "3×300",
    "area": 300,
    "version": 1,
    "review": "draft",
    "od": 88,
    "r20": 0.0601,
    "weight": 15622,
    "ac": 0.079473,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 20.6,
    "insulation": 4.5,
    "sheath": 3.7
   },
   {
    "id": "s-3382c86d.3x400",
    "key": "3×400",
    "area": 400,
    "version": 1,
    "review": "draft",
    "od": 95,
    "r20": 0.04700000000000001,
    "weight": 18724,
    "ac": 0.063682,
    "check": {
     "passed": 13,
     "missing": 21,
     "uncovered": 4
    },
    "conductor": 23.3,
    "insulation": 4.5,
    "sheath": 4
   }
  ]
 },
 {
  "id": "s-54f7c67b",
  "name": "人民电缆集团 YJV-8.7/15 kV 三芯",
  "manufacturer": "人民电缆集团",
  "designation": "YJV",
  "cores": 3,
  "u0_kv": 8.7,
  "u_kv": 15.0,
  "origin": "public",
  "standards": [
   "GB/T 12706.2-2020",
   "GB/T 3956-2008"
  ],
  "states": {
   "draft": 11
  },
  "by": "Agent",
  "specs": [
   {
    "id": "s-54f7c67b.3x25",
    "key": "3×25",
    "area": 25,
    "version": 1,
    "review": "draft",
    "od": 47,
    "r20": 0.727,
    "weight": 2367,
    "ac": 0.927128,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 6,
    "insulation": 4.5,
    "sheath": 2.4
   },
   {
    "id": "s-54f7c67b.3x35",
    "key": "3×35",
    "area": 35,
    "version": 1,
    "review": "draft",
    "od": 49,
    "r20": 0.524,
    "weight": 2791,
    "ac": 0.668346,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 7,
    "insulation": 4.5,
    "sheath": 2.5
   },
   {
    "id": "s-54f7c67b.3x50",
    "key": "3×50",
    "area": 50,
    "version": 1,
    "review": "draft",
    "od": 52.0,
    "r20": 0.387,
    "weight": 3307,
    "ac": 0.493745,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 8.1,
    "insulation": 4.5,
    "sheath": 2.6
   },
   {
    "id": "s-54f7c67b.3x70",
    "key": "3×70",
    "area": 70,
    "version": 1,
    "review": "draft",
    "od": 56.0,
    "r20": 0.268,
    "weight": 4136,
    "ac": 0.342178,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 9.9,
    "insulation": 4.5,
    "sheath": 2.7
   },
   {
    "id": "s-54f7c67b.3x95",
    "key": "3×95",
    "area": 95,
    "version": 1,
    "review": "draft",
    "od": 59.0,
    "r20": 0.193,
    "weight": 5072,
    "ac": 0.246771,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 11.5,
    "insulation": 4.5,
    "sheath": 2.8
   },
   {
    "id": "s-54f7c67b.3x120",
    "key": "3×120",
    "area": 120,
    "version": 1,
    "review": "draft",
    "od": 62.0,
    "r20": 0.153,
    "weight": 5941,
    "ac": 0.195996,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 12.9,
    "insulation": 4.5,
    "sheath": 2.9
   },
   {
    "id": "s-54f7c67b.3x150",
    "key": "3×150",
    "area": 150,
    "version": 1,
    "review": "draft",
    "od": 66,
    "r20": 0.124,
    "weight": 6936,
    "ac": 0.159289,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 14.3,
    "insulation": 4.5,
    "sheath": 3.1
   },
   {
    "id": "s-54f7c67b.3x185",
    "key": "3×185",
    "area": 185,
    "version": 1,
    "review": "draft",
    "od": 70,
    "r20": 0.0991,
    "weight": 8233,
    "ac": 0.127917,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 16,
    "insulation": 4.5,
    "sheath": 3.2
   },
   {
    "id": "s-54f7c67b.3x240",
    "key": "3×240",
    "area": 240,
    "version": 1,
    "review": "draft",
    "od": 75.0,
    "r20": 0.0754,
    "weight": 10124,
    "ac": 0.098314,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 18.4,
    "insulation": 4.5,
    "sheath": 3.3
   },
   {
    "id": "s-54f7c67b.3x300",
    "key": "3×300",
    "area": 300,
    "version": 1,
    "review": "draft",
    "od": 80,
    "r20": 0.0601,
    "weight": 12256,
    "ac": 0.079473,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 20.6,
    "insulation": 4.5,
    "sheath": 3.5
   },
   {
    "id": "s-54f7c67b.3x400",
    "key": "3×400",
    "area": 400,
    "version": 1,
    "review": "draft",
    "od": 87.0,
    "r20": 0.04700000000000001,
    "weight": 15030,
    "ac": 0.063682,
    "check": {
     "passed": 12,
     "missing": 16,
     "uncovered": 2
    },
    "conductor": 23.3,
    "insulation": 4.5,
    "sheath": 3.7
   }
  ]
 },
 {
  "id": "s-b832a847",
  "name": "人民电缆集团 YJV32-8.7/15 kV 三芯",
  "manufacturer": "人民电缆集团",
  "designation": "YJV32",
  "cores": 3,
  "u0_kv": 8.7,
  "u_kv": 15.0,
  "origin": "public",
  "standards": [
   "GB/T 12706.2-2020",
   "GB/T 3956-2008"
  ],
  "states": {
   "draft": 11
  },
  "by": "Agent",
  "specs": [
   {
    "id": "s-b832a847.3x25",
    "key": "3×25",
    "area": 25,
    "version": 1,
    "review": "draft",
    "od": 54.0,
    "r20": 0.727,
    "weight": 4966,
    "ac": 0.927128,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 6,
    "insulation": 4.5,
    "sheath": 2.6
   },
   {
    "id": "s-b832a847.3x35",
    "key": "3×35",
    "area": 35,
    "version": 1,
    "review": "draft",
    "od": 56,
    "r20": 0.524,
    "weight": 5488,
    "ac": 0.668346,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 7,
    "insulation": 4.5,
    "sheath": 2.7
   },
   {
    "id": "s-b832a847.3x50",
    "key": "3×50",
    "area": 50,
    "version": 1,
    "review": "draft",
    "od": 59.0,
    "r20": 0.387,
    "weight": 6170,
    "ac": 0.493745,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 8.1,
    "insulation": 4.5,
    "sheath": 2.9
   },
   {
    "id": "s-b832a847.3x70",
    "key": "3×70",
    "area": 70,
    "version": 1,
    "review": "draft",
    "od": 63,
    "r20": 0.268,
    "weight": 7378,
    "ac": 0.342178,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 9.9,
    "insulation": 4.5,
    "sheath": 3
   },
   {
    "id": "s-b832a847.3x95",
    "key": "3×95",
    "area": 95,
    "version": 1,
    "review": "draft",
    "od": 67.0,
    "r20": 0.193,
    "weight": 8386,
    "ac": 0.246771,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 11.5,
    "insulation": 4.5,
    "sheath": 3.1
   },
   {
    "id": "s-b832a847.3x120",
    "key": "3×120",
    "area": 120,
    "version": 1,
    "review": "draft",
    "od": 70,
    "r20": 0.153,
    "weight": 9473,
    "ac": 0.195996,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 12.9,
    "insulation": 4.5,
    "sheath": 3.2
   },
   {
    "id": "s-b832a847.3x150",
    "key": "3×150",
    "area": 150,
    "version": 1,
    "review": "draft",
    "od": 75,
    "r20": 0.124,
    "weight": 11565,
    "ac": 0.159289,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 14.3,
    "insulation": 4.5,
    "sheath": 3.4
   },
   {
    "id": "s-b832a847.3x185",
    "key": "3×185",
    "area": 185,
    "version": 1,
    "review": "draft",
    "od": 79.0,
    "r20": 0.0991,
    "weight": 13090,
    "ac": 0.127917,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 16,
    "insulation": 4.5,
    "sheath": 3.5
   },
   {
    "id": "s-b832a847.3x240",
    "key": "3×240",
    "area": 240,
    "version": 1,
    "review": "draft",
    "od": 85.0,
    "r20": 0.0754,
    "weight": 15421,
    "ac": 0.098314,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 18.4,
    "insulation": 4.5,
    "sheath": 3.6
   },
   {
    "id": "s-b832a847.3x300",
    "key": "3×300",
    "area": 300,
    "version": 1,
    "review": "draft",
    "od": 90,
    "r20": 0.0601,
    "weight": 17964,
    "ac": 0.079473,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 20.6,
    "insulation": 4.5,
    "sheath": 3.8
   },
   {
    "id": "s-b832a847.3x400",
    "key": "3×400",
    "area": 400,
    "version": 1,
    "review": "draft",
    "od": 97,
    "r20": 0.04700000000000001,
    "weight": 21228,
    "ac": 0.063682,
    "check": {
     "passed": 9,
     "missing": 21,
     "uncovered": 6
    },
    "conductor": 23.3,
    "insulation": 4.5,
    "sheath": 4.1
   }
  ]
 },
 {
  "id": "s-3111309a",
  "name": "人民电缆集团 YJV-8.7/15 kV 单芯",
  "manufacturer": "人民电缆集团",
  "designation": "YJV",
  "cores": 1,
  "u0_kv": 8.7,
  "u_kv": 15.0,
  "origin": "public",
  "standards": [
   "GB/T 12706.2-2020",
   "GB/T 3956-2008"
  ],
  "states": {
   "draft": 13
  },
  "by": "Agent",
  "specs": [
   {
    "id": "s-3111309a.1x25",
    "key": "1×25",
    "area": 25,
    "version": 1,
    "review": "draft",
    "od": 23.0,
    "r20": 0.727,
    "weight": 729,
    "ac": 0.927113,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 6,
    "insulation": 4.5,
    "sheath": 1.7
   },
   {
    "id": "s-3111309a.1x35",
    "key": "1×35",
    "area": 35,
    "version": 1,
    "review": "draft",
    "od": 24.0,
    "r20": 0.524,
    "weight": 848,
    "ac": 0.668321,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 7,
    "insulation": 4.5,
    "sheath": 1.7
   },
   {
    "id": "s-3111309a.1x50",
    "key": "1×50",
    "area": 50,
    "version": 1,
    "review": "draft",
    "od": 25,
    "r20": 0.387,
    "weight": 1008,
    "ac": 0.493707,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 8.1,
    "insulation": 4.5,
    "sheath": 1.8
   },
   {
    "id": "s-3111309a.1x70",
    "key": "1×70",
    "area": 70,
    "version": 1,
    "review": "draft",
    "od": 27.0,
    "r20": 0.268,
    "weight": 1252,
    "ac": 0.34211,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 9.9,
    "insulation": 4.5,
    "sheath": 1.8
   },
   {
    "id": "s-3111309a.1x95",
    "key": "1×95",
    "area": 95,
    "version": 1,
    "review": "draft",
    "od": 29,
    "r20": 0.193,
    "weight": 1554,
    "ac": 0.246659,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 11.5,
    "insulation": 4.5,
    "sheath": 1.9
   },
   {
    "id": "s-3111309a.1x120",
    "key": "1×120",
    "area": 120,
    "version": 1,
    "review": "draft",
    "od": 30,
    "r20": 0.153,
    "weight": 1820,
    "ac": 0.195853,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 12.9,
    "insulation": 4.5,
    "sheath": 1.9
   },
   {
    "id": "s-3111309a.1x150",
    "key": "1×150",
    "area": 150,
    "version": 1,
    "review": "draft",
    "od": 32,
    "r20": 0.124,
    "weight": 2129,
    "ac": 0.159085,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 14.3,
    "insulation": 4.5,
    "sheath": 2
   },
   {
    "id": "s-3111309a.1x185",
    "key": "1×185",
    "area": 185,
    "version": 1,
    "review": "draft",
    "od": 36.0,
    "r20": 0.0991,
    "weight": 2514,
    "ac": 0.127568,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 16,
    "insulation": 4.5,
    "sheath": 2
   },
   {
    "id": "s-3111309a.1x240",
    "key": "1×240",
    "area": 240,
    "version": 1,
    "review": "draft",
    "od": 36.0,
    "r20": 0.0754,
    "weight": 3124,
    "ac": 0.097949,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 18.4,
    "insulation": 4.5,
    "sheath": 2.1
   },
   {
    "id": "s-3111309a.1x300",
    "key": "1×300",
    "area": 300,
    "version": 1,
    "review": "draft",
    "od": 39.0,
    "r20": 0.0601,
    "weight": 3770,
    "ac": 0.078952,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 20.6,
    "insulation": 4.5,
    "sheath": 2.2
   },
   {
    "id": "s-3111309a.1x400",
    "key": "1×400",
    "area": 400,
    "version": 1,
    "review": "draft",
    "od": 42,
    "r20": 0.04700000000000001,
    "weight": 4634,
    "ac": 0.062991,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 23.3,
    "insulation": 4.5,
    "sheath": 2.3
   },
   {
    "id": "s-3111309a.1x500",
    "key": "1×500",
    "area": 500,
    "version": 1,
    "review": "draft",
    "od": 45,
    "r20": 0.0366,
    "weight": 5736,
    "ac": 0.050763,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 26.7,
    "insulation": 4.5,
    "sheath": 2.4
   },
   {
    "id": "s-3111309a.1x630",
    "key": "1×630",
    "area": 630,
    "version": 1,
    "review": "draft",
    "od": 49,
    "r20": 0.0283,
    "weight": 7187,
    "ac": 0.04134,
    "check": {
     "passed": 3,
     "missing": 7,
     "uncovered": 2
    },
    "conductor": 30.4,
    "insulation": 4.5,
    "sheath": 2.5
   }
  ]
 },
 {
  "id": "s-huayuan-yjv22-15kv",
  "name": "YJV22-8.7/15 kV 三芯（华远公开表）",
  "manufacturer": "华远",
  "designation": "YJV22",
  "cores": 3,
  "u0_kv": 8.7,
  "u_kv": 15.0,
  "origin": "public",
  "standards": [],
  "states": {
   "published": 10
  },
  "by": "系统",
  "specs": [
   {
    "id": "huayuan.yjv22-15kv-35",
    "key": "3×35",
    "area": 35,
    "version": 1,
    "review": "published",
    "od": 52.201,
    "r20": 0.524,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "huayuan.yjv22-15kv-50",
    "key": "3×50",
    "area": 50,
    "version": 1,
    "review": "published",
    "od": 55.618,
    "r20": 0.387,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "huayuan.yjv22-15kv-70",
    "key": "3×70",
    "area": 70,
    "version": 1,
    "review": "published",
    "od": 59.265,
    "r20": 0.268,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "huayuan.yjv22-15kv-95",
    "key": "3×95",
    "area": 95,
    "version": 1,
    "review": "published",
    "od": 63.313,
    "r20": 0.193,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "huayuan.yjv22-15kv-120",
    "key": "3×120",
    "area": 120,
    "version": 1,
    "review": "published",
    "od": 66.729,
    "r20": 0.153,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "huayuan.yjv22-15kv-150",
    "key": "3×150",
    "area": 150,
    "version": 1,
    "review": "published",
    "od": 70.377,
    "r20": 0.124,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "huayuan.yjv22-15kv-185",
    "key": "3×185",
    "area": 185,
    "version": 1,
    "review": "published",
    "od": 74.224,
    "r20": 0.0991,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "huayuan.yjv22-15kv-240",
    "key": "3×240",
    "area": 240,
    "version": 1,
    "review": "published",
    "od": 79.78,
    "r20": 0.0754,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "huayuan.yjv22-15kv-300",
    "key": "3×300",
    "area": 300,
    "version": 1,
    "review": "published",
    "od": 86.105,
    "r20": 0.0601,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "huayuan.yjv22-15kv-400",
    "key": "3×400",
    "area": 400,
    "version": 1,
    "review": "published",
    "od": 93.6,
    "r20": 0.04700000000000001,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   }
  ]
 },
 {
  "id": "s-system-yjv22-15kv",
  "name": "YJV22-8.7/15 kV 三芯",
  "manufacturer": "结构演示",
  "designation": "YJV22",
  "cores": 3,
  "u0_kv": 8.7,
  "u_kv": 15.0,
  "origin": "demo",
  "standards": [],
  "states": {
   "published": 1
  },
  "by": "系统",
  "specs": [
   {
    "id": "system.yjv22-15kv-300",
    "key": "3×300",
    "area": 300,
    "version": 1,
    "review": "published",
    "od": 86.105,
    "r20": 0.0601,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   }
  ]
 },
 {
  "id": "s-system-cu-xlpe-10kv",
  "name": "6/10 kV 单芯",
  "manufacturer": "结构演示",
  "designation": "",
  "cores": 1,
  "u0_kv": 6.0,
  "u_kv": 10.0,
  "origin": "demo",
  "standards": [],
  "states": {
   "published": 1
  },
  "by": "系统",
  "specs": [
   {
    "id": "system.cu-xlpe-10kv-240",
    "key": "1×240",
    "area": 240,
    "version": 1,
    "review": "published",
    "od": 33.2,
    "r20": 0.07540000000000001,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   }
  ]
 },
 {
  "id": "s-system-cu-xlpe-al",
  "name": "YJL02-12/20 kV 单芯",
  "manufacturer": "结构演示",
  "designation": "YJL02",
  "cores": 1,
  "u0_kv": 12.0,
  "u_kv": 20.0,
  "origin": "demo",
  "standards": [],
  "states": {
   "published": 2
  },
  "by": "系统",
  "specs": [
   {
    "id": "system.cu-xlpe-al-240",
    "key": "1×240",
    "area": 240,
    "version": 1,
    "review": "published",
    "od": 38.7,
    "r20": 0.07540000000000001,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   },
   {
    "id": "system.cu-xlpe-al-400",
    "key": "1×400",
    "area": 400,
    "version": 1,
    "review": "published",
    "od": 45.2,
    "r20": 0.047,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   }
  ]
 },
 {
  "id": "s-public-qifan",
  "name": "64/110 kV 单芯",
  "manufacturer": "起帆",
  "designation": "YJLW03",
  "cores": 1,
  "u0_kv": 64.0,
  "u_kv": 110.0,
  "origin": "public",
  "standards": [],
  "states": {
   "published": 1
  },
  "by": "系统",
  "specs": [
   {
    "id": "public.qifan.yjlw03-110kv-800",
    "key": "1×800",
    "area": 800,
    "version": 1,
    "review": "published",
    "od": 100.6,
    "r20": 0.022099999999999998,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   }
  ]
 },
 {
  "id": "s-system-yjq02-110kv",
  "name": "64/110 kV 单芯（结构演示）",
  "manufacturer": "结构演示",
  "designation": "YJQ02",
  "cores": 1,
  "u0_kv": 64.0,
  "u_kv": 110.0,
  "origin": "demo",
  "standards": [],
  "states": {
   "published": 1
  },
  "by": "系统",
  "specs": [
   {
    "id": "system.yjq02-110kv-800",
    "key": "1×800",
    "area": 800,
    "version": 1,
    "review": "published",
    "od": 83.8,
    "r20": 0.022099999999999998,
    "weight": null,
    "ac": null,
    "check": null,
    "conductor": null,
    "insulation": null,
    "sheath": null
   }
  ]
 }
] as LibrarySeries[];

export const WORKSPACE = {
 "name": "YJV22-8.7/15 kV 3×240",
 "series": "人民电缆集团 YJV22-8.7/15 kV 三芯",
 "version": {
  "number": 3,
  "review": "reviewed",
  "note": "减薄后核对不过，恢复 4.5 mm",
  "created": "2026-11-16T06:05:54.260Z"
 },
 "structure": [
  {
   "key": "area",
   "label": "标称截面",
   "unit": "mm²",
   "value": 240,
   "origin": "table"
  },
  {
   "key": "conductor_diameter",
   "label": "导体外径",
   "unit": "mm",
   "value": 18.4,
   "origin": "table"
  },
  {
   "key": "conductor_screen_thickness",
   "label": "导体屏蔽厚度",
   "unit": "mm",
   "value": 0.8,
   "origin": "series",
   "basis": "目录未列；取同电压等级公开结构表（江苏华远 YJV22-8.7/15 kV）的列示值"
  },
  {
   "key": "insulation_thickness",
   "label": "绝缘标称厚度",
   "unit": "mm",
   "value": 4.5,
   "origin": "table"
  },
  {
   "key": "insulation_screen_thickness",
   "label": "绝缘屏蔽厚度",
   "unit": "mm",
   "value": 0.7,
   "origin": "series",
   "basis": "目录未列；取同电压等级公开结构表（江苏华远 YJV22-8.7/15 kV）的列示值"
  },
  {
   "key": "screen_tape_thickness",
   "label": "铜带厚度",
   "unit": "mm",
   "value": 0.1,
   "origin": "series",
   "basis": "目录未列；取 GB/T 12706.2—2020 10.2.3 规定的最小标称厚度"
  },
  {
   "key": "binder_thickness",
   "label": "包带厚度",
   "unit": "mm",
   "value": 0.2,
   "origin": "series",
   "basis": "目录未列；取同电压等级公开结构表（江苏华远 YJV22-8.7/15 kV）的包带厚度"
  },
  {
   "key": "bedding_thickness",
   "label": "内衬层厚度",
   "unit": "mm",
   "value": 1.9,
   "origin": "table"
  },
  {
   "key": "armour_tape_thickness",
   "label": "钢带厚度",
   "unit": "mm",
   "value": 0.5,
   "origin": "table"
  },
  {
   "key": "armour_tape_width",
   "label": "钢带宽度",
   "unit": "mm",
   "value": 50,
   "origin": "series",
   "basis": "目录未列；钢带损耗按间隙率计，结果与带宽无关"
  },
  {
   "key": "oversheath_thickness",
   "label": "外护套标称厚度",
   "unit": "mm",
   "value": 3.5,
   "origin": "table"
  },
  {
   "key": "outer_diameter",
   "label": "电缆近似外径",
   "unit": "mm",
   "value": 82,
   "origin": "table"
  },
  {
   "key": "weight",
   "label": "电缆近似重量",
   "unit": "kg/km",
   "value": 12371,
   "origin": "table"
  },
  {
   "key": "r20",
   "label": "20 °C 导体直流电阻",
   "unit": "Ω/km",
   "value": 0.0754,
   "origin": "standard",
   "basis": "GB/T 3956—2008 表 2，第 2 种导体 20 °C 直流电阻上限，PDF 第 7 页"
  }
 ],
 "closure": {
  "declared_mm": 82,
  "listed_mm": 79.56477658208095,
  "residual_mm": 1.2176117089595233,
  "tolerance_mm": 1.32,
  "placed_in": "filler"
 },
 "derivation": "由 cablesim.iec60287 1.2.0 model-completion 推导，径向尺寸闭合已核对；铜带纵向电阻按系列声明的接触模型得出。",
 "electrical": [
  {
   "id": "core/1:r20",
   "title": "芯 1 · 导体 R₂₀",
   "value": 7.539999999999999e-05,
   "unit": "Ω/m",
   "status": "available",
   "standard": "IEC 60287-1-1:2023",
   "clause": "5.1.2",
   "reason": "设计输入、实测值和声明上限分别保留；标准限值不作为实测电阻。"
  },
  {
   "id": "core/1:dc",
   "title": "芯 1 · 工作温度直流电阻",
   "value": 9.614254e-05,
   "unit": "Ω/m",
   "status": "available",
   "standard": "IEC 60287-1-1:2023",
   "clause": "5.1.2；附录 A",
   "reason": "需明确工作温度、R20 长度基准及三芯成缆绞入系数。"
  },
  {
   "id": "core/1:ys",
   "title": "芯 1 · 集肤因数 yₛ",
   "value": 0.008858652301969005,
   "unit": "1",
   "status": "available",
   "standard": "IEC 60287-1-1:2023",
   "clause": "5.1.3"
  },
  {
   "id": "core/1:yp",
   "title": "芯 1 · 邻近因数 yₚ",
   "value": 0.013730302624318307,
   "unit": "1",
   "status": "available",
   "standard": "IEC 60287-1-1:2023",
   "clause": "5.1.5.1",
   "reason": "需明确相间中心距和系数来源；型号不内置敷设间距。"
  },
  {
   "id": "core/1:ac",
   "title": "芯 1 · 交流电阻",
   "value": 9.831429950255876e-05,
   "unit": "Ω/m",
   "status": "available",
   "standard": "IEC 60287-1-1:2023",
   "clause": "5.1.1，式 (7)；附录 A"
  },
  {
   "id": "core/1:capacitance",
   "title": "芯 1 · 每相电容",
   "value": 3.7480971404266427e-10,
   "unit": "F/m",
   "status": "available",
   "standard": "IEC 60287-1-1:2023",
   "clause": "5.2；附录 A",
   "reason": "需完整圆柱屏蔽构造、介电常数和长度修正；非屏蔽多芯电容不套用此式。"
  },
  {
   "id": "core/1:charging",
   "title": "芯 1 · 每相充电电流 / 长度",
   "value": 0.001024424516393557,
   "unit": "A/m",
   "status": "available",
   "standard": "IEC 60287-1-1:2023",
   "clause": "5.2（由 I=ωCU 导出）",
   "reason": "使用明确的运行相电压，不把型号 U₀ 当运行电压。"
  },
  {
   "id": "core/1:dielectric",
   "title": "芯 1 · 每相介质损耗",
   "value": 0.035649973170495786,
   "unit": "W/m",
   "status": "available",
   "standard": "IEC 60287-1-1:2023",
   "clause": "5.2"
  },
  {
   "id": "core/1:geometric-inductance",
   "title": "芯 1 · 导体几何电感（不含金属回路）",
   "value": null,
   "unit": "H/m",
   "status": "uncovered",
   "standard": "IEC 60287-1-3:2023",
   "clause": "4.2，式 (9)，表 1（等距平衡回路导出）",
   "reason": "仅等距单芯圆实心 / 紧压导体的几何项；不包含护套电流或大地返回，不能当作完整型号电感。"
  },
  {
   "id": "core/1:geometric-reactance",
   "title": "芯 1 · 导体几何感抗（不含金属回路）",
   "value": null,
   "unit": "Ω/m",
   "status": "uncovered",
   "standard": "IEC 60287-1-3:2023",
   "clause": "4.2，式 (9)"
  },
  {
   "id": "common:inductance",
   "title": "完整回路正序电感（自感与互感）",
   "value": null,
   "unit": "H/m",
   "status": "missing",
   "standard": "IEC 60287-1-3:2023",
   "clause": "4.2 式 (9)；4.3 阻抗矩阵",
   "reason": "缺字段：频率、相间几何或护层连接及来源；填写后重算。"
  },
  {
   "id": "common:positive-sequence",
   "title": "正序阻抗 Z₁",
   "value": null,
   "unit": "Ω/m",
   "status": "missing",
   "standard": "IEC 60287-1-3:2023",
   "clause": "4.2 式 (9)；4.3 阻抗矩阵",
   "reason": "缺字段：频率、相间几何或护层连接及来源；填写后重算。"
  },
  {
   "id": "common:zero-sequence",
   "title": "零序阻抗 Z₀",
   "value": null,
   "unit": "Ω/m",
   "status": "missing",
   "standard": "IEC 60287-1-3:2023",
   "clause": "4.2 式 (9)；4.3 阻抗矩阵",
   "reason": "缺字段：频率、相间几何或护层连接及来源；填写后重算。"
  }
 ],
 "check": [
  {
   "title": "芯 1 · 导体 R₂₀",
   "verdict": "passed",
   "standard": "GB/T 3956—2008",
   "clause": "表 2",
   "limit": 0.0754,
   "actual": 0.0754,
   "unit": "Ω/km",
   "comparison": "<=",
   "reason": null
  },
  {
   "title": "芯 1 · 绝缘标称厚度",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "表 7",
   "limit": 4.5,
   "actual": 4.500000000000001,
   "unit": "mm",
   "comparison": ">=",
   "reason": null
  },
  {
   "title": "芯 1 · 绝缘最薄点",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "17.5.2",
   "limit": 3.9500000000000006,
   "actual": null,
   "unit": "mm",
   "comparison": ">=",
   "reason": "t_n 为该层规定标称厚度；不低于标准标称要求，采用更厚的设计时随之提高。最薄点必须录入实测值。"
  },
  {
   "title": "芯 1 · 绝缘厚度偏差",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "17.5.2",
   "limit": 0.15,
   "actual": null,
   "unit": "1",
   "comparison": "<=",
   "reason": "需录入同一试样的最薄点和最大实测厚度。"
  },
  {
   "title": "芯 1 · 屏蔽铜带标称厚度",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.1,
   "actual": 0.1,
   "unit": "mm",
   "comparison": ">=",
   "reason": null
  },
  {
   "title": "芯 1 · 屏蔽铜带最薄点",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.09000000000000001,
   "actual": null,
   "unit": "mm",
   "comparison": ">=",
   "reason": "缺字段：芯 1 · 屏蔽铜带最薄点；补录相应输入或实测值后重新核对。"
  },
  {
   "title": "芯 1 · 屏蔽铜带标称搭盖率",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.15,
   "actual": 0.15,
   "unit": "1",
   "comparison": ">=",
   "reason": null
  },
  {
   "title": "芯 1 · 屏蔽铜带最小搭盖率",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.05,
   "actual": null,
   "unit": "1",
   "comparison": ">=",
   "reason": "缺字段：芯 1 · 屏蔽铜带最小搭盖率；补录相应输入或实测值后重新核对。"
  },
  {
   "title": "芯 1 · 屏蔽标称截面",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": null,
   "actual": null,
   "unit": "mm²",
   "comparison": null,
   "reason": "需工程输入与短路容量依据；待补：屏蔽设计截面、屏蔽短路电流、屏蔽短路持续时间、屏蔽短路容量依据。标准未规定固定截面，不据此判为通过。"
  },
  {
   "title": "芯 2 · 导体 R₂₀",
   "verdict": "passed",
   "standard": "GB/T 3956—2008",
   "clause": "表 2",
   "limit": 0.0754,
   "actual": 0.0754,
   "unit": "Ω/km",
   "comparison": "<=",
   "reason": null
  },
  {
   "title": "芯 2 · 绝缘标称厚度",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "表 7",
   "limit": 4.5,
   "actual": 4.500000000000001,
   "unit": "mm",
   "comparison": ">=",
   "reason": null
  },
  {
   "title": "芯 2 · 绝缘最薄点",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "17.5.2",
   "limit": 3.9500000000000006,
   "actual": null,
   "unit": "mm",
   "comparison": ">=",
   "reason": "t_n 为该层规定标称厚度；不低于标准标称要求，采用更厚的设计时随之提高。最薄点必须录入实测值。"
  },
  {
   "title": "芯 2 · 绝缘厚度偏差",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "17.5.2",
   "limit": 0.15,
   "actual": null,
   "unit": "1",
   "comparison": "<=",
   "reason": "需录入同一试样的最薄点和最大实测厚度。"
  },
  {
   "title": "芯 2 · 屏蔽铜带标称厚度",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.1,
   "actual": 0.1,
   "unit": "mm",
   "comparison": ">=",
   "reason": null
  },
  {
   "title": "芯 2 · 屏蔽铜带最薄点",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.09000000000000001,
   "actual": null,
   "unit": "mm",
   "comparison": ">=",
   "reason": "缺字段：芯 2 · 屏蔽铜带最薄点；补录相应输入或实测值后重新核对。"
  },
  {
   "title": "芯 2 · 屏蔽铜带标称搭盖率",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.15,
   "actual": 0.15,
   "unit": "1",
   "comparison": ">=",
   "reason": null
  },
  {
   "title": "芯 2 · 屏蔽铜带最小搭盖率",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.05,
   "actual": null,
   "unit": "1",
   "comparison": ">=",
   "reason": "缺字段：芯 2 · 屏蔽铜带最小搭盖率；补录相应输入或实测值后重新核对。"
  },
  {
   "title": "芯 2 · 屏蔽标称截面",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": null,
   "actual": null,
   "unit": "mm²",
   "comparison": null,
   "reason": "需工程输入与短路容量依据；待补：屏蔽设计截面、屏蔽短路电流、屏蔽短路持续时间、屏蔽短路容量依据。标准未规定固定截面，不据此判为通过。"
  },
  {
   "title": "芯 3 · 导体 R₂₀",
   "verdict": "passed",
   "standard": "GB/T 3956—2008",
   "clause": "表 2",
   "limit": 0.0754,
   "actual": 0.0754,
   "unit": "Ω/km",
   "comparison": "<=",
   "reason": null
  },
  {
   "title": "芯 3 · 绝缘标称厚度",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "表 7",
   "limit": 4.5,
   "actual": 4.500000000000001,
   "unit": "mm",
   "comparison": ">=",
   "reason": null
  },
  {
   "title": "芯 3 · 绝缘最薄点",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "17.5.2",
   "limit": 3.9500000000000006,
   "actual": null,
   "unit": "mm",
   "comparison": ">=",
   "reason": "t_n 为该层规定标称厚度；不低于标准标称要求，采用更厚的设计时随之提高。最薄点必须录入实测值。"
  },
  {
   "title": "芯 3 · 绝缘厚度偏差",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "17.5.2",
   "limit": 0.15,
   "actual": null,
   "unit": "1",
   "comparison": "<=",
   "reason": "需录入同一试样的最薄点和最大实测厚度。"
  },
  {
   "title": "芯 3 · 屏蔽铜带标称厚度",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.1,
   "actual": 0.1,
   "unit": "mm",
   "comparison": ">=",
   "reason": null
  },
  {
   "title": "芯 3 · 屏蔽铜带最薄点",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.09000000000000001,
   "actual": null,
   "unit": "mm",
   "comparison": ">=",
   "reason": "缺字段：芯 3 · 屏蔽铜带最薄点；补录相应输入或实测值后重新核对。"
  },
  {
   "title": "芯 3 · 屏蔽铜带标称搭盖率",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.15,
   "actual": 0.15,
   "unit": "1",
   "comparison": ">=",
   "reason": null
  },
  {
   "title": "芯 3 · 屏蔽铜带最小搭盖率",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": 0.05,
   "actual": null,
   "unit": "1",
   "comparison": ">=",
   "reason": "缺字段：芯 3 · 屏蔽铜带最小搭盖率；补录相应输入或实测值后重新核对。"
  },
  {
   "title": "芯 3 · 屏蔽标称截面",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "10.2.3",
   "limit": null,
   "actual": null,
   "unit": "mm²",
   "comparison": null,
   "reason": "需工程输入与短路容量依据；待补：屏蔽设计截面、屏蔽短路电流、屏蔽短路持续时间、屏蔽短路容量依据。标准未规定固定截面，不据此判为通过。"
  },
  {
   "title": "内衬层标称厚度",
   "verdict": "uncovered",
   "standard": "GB/T 12706.2—2020",
   "clause": "8.2.3，表 9",
   "limit": null,
   "actual": 1.9,
   "unit": "mm",
   "comparison": ">=",
   "reason": "本库暂未收录 · 下一轮；保留此标准版本与要求。"
  },
  {
   "title": "内衬层最薄点",
   "verdict": "uncovered",
   "standard": "GB/T 12706.2—2020",
   "clause": "17.5.3，式 (6)；附录 B 表 B.1",
   "limit": null,
   "actual": null,
   "unit": "mm",
   "comparison": ">=",
   "reason": "本库暂未收录 · 下一轮；保留此标准版本与要求。"
  },
  {
   "title": "铠装材料类别",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "13.2",
   "limit": null,
   "actual": null,
   "unit": "1",
   "comparison": "in",
   "reason": "缺字段：铠装材料标准类别；普通钢不能自动视为镀锌钢。"
  },
  {
   "title": "铠装下内衬层或挤包隔离套",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "13.3.2",
   "limit": null,
   "actual": null,
   "unit": "1",
   "comparison": null,
   "reason": "内衬已声明；其标称厚度、最薄点和适用构造仍须全部核对。"
  },
  {
   "title": "金属层间挤包隔离套适用条件",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "13.3.1 / 13.3.2 / 13.3.3",
   "limit": null,
   "actual": null,
   "unit": "1",
   "comparison": ">=",
   "reason": "缺字段：金属层间纵向阻水隔层、铠装及相邻金属材料标准类别；补齐后按固定标准版本查询依据。"
  },
  {
   "title": "铠装金属带层数",
   "verdict": "passed",
   "standard": "GB/T 12706.2—2020",
   "clause": "13.7",
   "limit": 2,
   "actual": 2,
   "unit": "1",
   "comparison": "=",
   "reason": null
  },
  {
   "title": "铠装金属带最大间隙率",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "13.7",
   "limit": 0.5,
   "actual": null,
   "unit": "1",
   "comparison": "<=",
   "reason": "缺字段：铠装第 1 层最大间隙率、铠装第 2 层最大间隙率；逐层记录，不把一层间隙沿用到其他层。"
  },
  {
   "title": "铠装单带标称厚度",
   "verdict": "uncovered",
   "standard": "GB/T 12706.2—2020",
   "clause": "13.5，表 11",
   "limit": null,
   "actual": 0.5,
   "unit": "mm",
   "comparison": ">=",
   "reason": "本库暂未收录 · 下一轮；保留此标准版本与要求。"
  },
  {
   "title": "铠装金属带实测厚度",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "17.7.3",
   "limit": 0.45,
   "actual": null,
   "unit": "mm",
   "comparison": ">=",
   "reason": "缺字段：铠装带实测厚度；按 17.7.2 测量方法记录平均值，不以标称厚度代替。"
  },
  {
   "title": "外护套标称厚度",
   "verdict": "uncovered",
   "standard": "GB/T 12706.2—2020",
   "clause": "14.3",
   "limit": null,
   "actual": 3.5,
   "unit": "mm",
   "comparison": ">=",
   "reason": "依据已核验；此公式尚未绑定完整附录 A/B 计算链，本项保留未覆盖。"
  },
  {
   "title": "外护套最薄点",
   "verdict": "missing",
   "standard": "GB/T 12706.2—2020",
   "clause": "17.5.3",
   "limit": 2.6,
   "actual": null,
   "unit": "mm",
   "comparison": ">=",
   "reason": "t_n 为规定标称厚度；已知的标准标称要求不因较薄设计而降低。"
  }
 ],
 "short_circuit": [
  {
   "id": "core/1:conductor-adiabatic",
   "title": "芯 1 · 导体绝热允许短路电流",
   "value": 34340.04159876265,
   "unit": "A",
   "status": "available",
   "standard": "IEC 60949:1988",
   "clause": "3",
   "reason": "按输入初末温度及已查询材料依据计算单个组件容量；缺依据时重新查询，不补默认常数。"
  },
  {
   "id": "core/1:conductor-factor",
   "title": "芯 1 · 导体非绝热修正因数",
   "value": 1.0133930067841814,
   "unit": "1",
   "status": "available",
   "standard": "IEC 60949:1988",
   "clause": "5.2",
   "reason": "只覆盖已查询铜 / 铝导体与 XLPE 的表 III 组合。"
  },
  {
   "id": "core/1:conductor-nonadiabatic",
   "title": "芯 1 · 导体非绝热允许短路电流",
   "value": 34799.95800886395,
   "unit": "A",
   "status": "available",
   "standard": "IEC 60949:1988",
   "clause": "3"
  },
  {
   "id": "core/1:metallic_screen-adiabatic",
   "title": "芯 1 · 金属组件绝热允许电流",
   "value": null,
   "unit": "A",
   "status": "missing",
   "standard": "IEC 60949:1988",
   "clause": "3",
   "reason": "缺字段：金属屏蔽或护套实际截面及来源。"
  },
  {
   "id": "core/1:metallic_screen-factor",
   "title": "金属组件非绝热修正因数",
   "value": null,
   "unit": "1",
   "status": "missing",
   "standard": "IEC 60949:1988",
   "clause": "6.1",
   "reason": "需金属组件厚度、相邻两侧介质热参数和接触因数的来源。"
  },
  {
   "id": "core/1:metallic_screen-nonadiabatic",
   "title": "金属组件非绝热允许电流",
   "value": null,
   "unit": "A",
   "status": "missing",
   "standard": "IEC 60949:1988",
   "clause": "3",
   "reason": "需金属组件厚度、相邻两侧介质热参数和接触因数的来源。"
  },
  {
   "id": "core/1:metallic_screen-fault-check",
   "title": "芯 1 · 金属组件故障电流校核",
   "value": null,
   "unit": "A",
   "status": "missing",
   "standard": "IEC 60949:1988",
   "clause": "3",
   "reason": "需工程输入：容量口径、此组件故障电流、保护清除时间、初温与允许终温；不将导体温限替代金属部件温限。"
  },
  {
   "id": "common:armour-adiabatic",
   "title": "金属组件绝热允许电流",
   "value": null,
   "unit": "A",
   "status": "missing",
   "standard": "IEC 60949:1988",
   "clause": "3",
   "reason": "缺字段：金属材料标准类别；请在材料属性中明确铜、铝或铅。"
  },
  {
   "id": "common:armour-factor",
   "title": "金属组件非绝热修正因数",
   "value": null,
   "unit": "1",
   "status": "missing",
   "standard": "IEC 60949:1988",
   "clause": "6.1",
   "reason": "需金属组件厚度、相邻两侧介质热参数和接触因数的来源。"
  },
  {
   "id": "common:armour-nonadiabatic",
   "title": "金属组件非绝热允许电流",
   "value": null,
   "unit": "A",
   "status": "missing",
   "standard": "IEC 60949:1988",
   "clause": "3",
   "reason": "需金属组件厚度、相邻两侧介质热参数和接触因数的来源。"
  },
  {
   "id": "common:armour-fault-check",
   "title": "金属组件故障电流校核",
   "value": null,
   "unit": "A",
   "status": "missing",
   "standard": "IEC 60949:1988",
   "clause": "3",
   "reason": "需工程输入：容量口径、此组件故障电流、保护清除时间、初温与允许终温；不将导体温限替代金属部件温限。"
  },
  {
   "id": "common:parallel-fault-sharing",
   "title": "金属回路故障分流校核",
   "value": null,
   "unit": "A",
   "status": "missing",
   "standard": "IEC 60949:1988/AMD1:2008",
   "clause": "4 amendment",
   "reason": "需工程输入：接地连接、故障回流路径、故障电流，以及每个并联部件的电阻、初温、终温和来源；不默认各组件同温。"
  }
 ],
 "short_circuit_conditions": {
  "values": {
   "duration_s": 1,
   "initial_temperature_k": 363.15,
   "final_temperature_k": 523.15
  },
  "sources": {
   "duration_s": "短路持续时间 1 s（规格书口径）",
   "initial_temperature_k": "短路前导体处于最高连续工作温度",
   "final_temperature_k": "XLPE 绝缘导体短路允许最高温度 250 °C（GB/T 12706.2—2020）"
  }
 },
 "check_method": {
  "plugin_id": "cablesim.standard-check",
  "plugin_version": "1.6.1"
 },
 "electrical_method": {
  "plugin_id": "cablesim.type-electrical",
  "plugin_version": "1.1.1"
 },
 "short_circuit_method": {
  "plugin_id": "cablesim.type-electrical",
  "plugin_version": "1.1.1"
 }
};
