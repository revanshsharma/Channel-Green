import { writeFileSync } from 'node:fs';
import { PixelBuffer, renderAvatarFrames, renderLyingFrames, randomAvatar, FRAME_W, FRAME_H, LIE_W, LIE_H } from '@channel-green/shared';
import { registry } from '../src/index';
import { encodePng } from './preview';
const names = ['idle0','sit0','cup0','cup1','cup2','scup0','scup1','scup2','str0','str1'] as const;
const looks = [1,7,12].map((s)=>randomAvatar(registry.avatar, s));
const dirs = ['down','left','up'] as const;
const sheet = new PixelBuffer(FRAME_W*names.length + 6, (FRAME_H*3+4)*looks.length + (LIE_H+2)*looks.length);
sheet.rect(0,0,sheet.w,sheet.h,'#3f7a4f');
let oy=0;
looks.forEach((l)=>{
  const f = renderAvatarFrames(l, registry.avatar);
  dirs.forEach((d,r)=>names.forEach((n,c)=>sheet.blit(f[`${d}-${n}`], c*FRAME_W, oy + r*(FRAME_H+1))));
  oy += FRAME_H*3+4;
  const lf = renderLyingFrames(l, registry.avatar);
  (['left','right'] as const).forEach((d,i)=>(['lie0','lie1','lie2'] as const).forEach((n,c)=>sheet.blit(lf[`${d}-${n}` as 'left-lie0'], (c+i*3)*(LIE_W+1), oy)));
  oy += LIE_H+2;
});
writeFileSync('/workspace/agent/channel-green-work/scratch/frames.png', encodePng(sheet, 4));
