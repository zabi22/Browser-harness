import {describe,it,expect} from 'vitest';
import git from 'isomorphic-git';
import {repoFs,type RepoData} from './git-fs';
import {advertise,uploadPack,parsePkts,pkt,joinBytes} from './git-http.server';
import {cloneExpiry} from './cloud-git';
describe('cloud Git protocol',()=>{
  it('clone credentials expire exactly five minutes after issuance',()=>expect(cloneExpiry(1000000)).toBe(new Date(1300000).toISOString()));
  it('rejects truncated Git packets',()=>expect(()=>parsePkts(new TextEncoder().encode('0008abc'))).toThrow());
  it('rejects trailing malformed input',()=>expect(()=>parsePkts(joinBytes([pkt('done\n'),new Uint8Array([1])]))).toThrow());
  it('creates an actual cloneable pack with commits and files',async()=>{
    const data:RepoData={};const fs=repoFs(data);
    await git.init({fs,dir:'/',defaultBranch:'main'});
    await fs.promises.writeFile('/README.md','Verified Git repository');await git.add({fs,dir:'/',filepath:'README.md'});
    const oid=await git.commit({fs,dir:'/',message:'first',author:{name:'Test',email:'test@obh.local'}});
    const refs=new TextDecoder().decode(await advertise(data));expect(refs).toContain(oid+' HEAD');
    const raw=await uploadPack(data,joinBytes([pkt('want '+oid+'\n'),new TextEncoder().encode('0000'),pkt('done\n')]));
    const pack=raw.slice(pkt('NAK\n').length);expect(new TextDecoder().decode(pack.slice(0,4))).toBe('PACK');
    const target=repoFs({});await git.init({fs:target,dir:'/',defaultBranch:'main'});await target.promises.writeFile('/.git/objects/pack/pack-test.pack',pack);
    await git.indexPack({fs:target,dir:'/',filepath:'.git/objects/pack/pack-test.pack'});await git.writeRef({fs:target,dir:'/',ref:'refs/heads/main',value:oid});await git.checkout({fs:target,dir:'/',ref:'main'});
    expect(await target.promises.readFile('/README.md','utf8')).toBe('Verified Git repository');
  });
});