import {it,expect,vi} from 'vitest';
import {LinuxEnvironment} from './linux-environment';
it('restart resumes a paused guest before checkpoint and reboot',async()=>{
  const env=new LinuxEnvironment('test');env.state='paused';
  const order:string[]=[];
  vi.spyOn(env,'resume').mockImplementation(async()=>{order.push('resume');env.state='running';});
  vi.spyOn(env,'checkpoint').mockImplementation(async()=>{if(env.state==='paused')await env.resume();order.push('save');});
  vi.spyOn(env,'stop').mockImplementation(()=>{order.push('stop');env.state='stopped';});
  vi.spyOn(env,'start').mockImplementation(async()=>{order.push('boot');});
  await env.restart();expect(order).toEqual(['resume','save','stop','boot']);
});
it('restart cannot discard a conflicting local checkpoint',async()=>{
  const env=new LinuxEnvironment('test');env.state='running';
  vi.spyOn(env,'checkpoint').mockImplementation(async()=>{env.state='conflict';});
  const stop=vi.spyOn(env,'stop');await expect(env.restart()).rejects.toThrow('Save disk before restarting');expect(stop).not.toHaveBeenCalled();
});
it('commands resume an existing paused guest without creating a replacement worker',async()=>{
  const env=new LinuxEnvironment('paused');env.state='paused';
  Object.assign(env,{worker:{postMessage:vi.fn()}});
  const resume=vi.spyOn(env,'resume').mockImplementation(async()=>{env.state='running';});
  await env.start();expect(resume).toHaveBeenCalledOnce();expect(env.state).toBe('running');
});