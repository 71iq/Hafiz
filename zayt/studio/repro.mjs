import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cache,studio,select,frameDir,json} from './common.mjs';
const [job]=select([process.argv[2]||'A06-S']);const record=()=>JSON.parse(fs.readFileSync(path.join(frameDir(job),'capture.json')));
const before=record();execFileSync(process.execPath,[path.join(studio,'render.mjs'),job.key],{stdio:'inherit'});const after=record();assert.deepEqual(before.hashes,after.hashes);json(path.join(cache,'repro.json'),{key:job.key,count:before.hashes.length,first:before.sequence,second:after.sequence});
