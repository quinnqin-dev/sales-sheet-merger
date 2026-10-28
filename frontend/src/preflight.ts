export function memoryEstimate(rows:number,columns:number,device:{deviceMemory?:number;userAgent?:string}) {
 const bytes=rows*columns*256;
 return {bytes,warn:rows>50000&&((device.deviceMemory??Infinity)<=4||/Android|iPhone|iPad|iPod|Mobile/i.test(device.userAgent??''))};
}
