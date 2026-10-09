export async function initialize(context){return JSON.parse(Buffer.from(await context.readVerifiedInput('dataset')).toString('utf8'));}
export async function runTask(input,state){
 await new Promise(done=>setTimeout(done,input.delay??0));
 if(input.fail)throw Error('Deliberate worker failure');
 if(input.exit)process.exit(23);
 if(input.invalid)return new Date();
 return {value:input.value+state.offset,padding:'x'.repeat(input.padding??0)};
}
