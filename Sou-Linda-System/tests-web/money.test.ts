import { describe,expect,it } from 'vitest';
import { cents } from '../src/domain/format';

describe('entrada de importes en centavos exactos',()=>{
  it('conserva los centavos que el punto flotante aproxima',()=>{
    expect(cents('0,29')).toBe(29);
    expect(cents('100.01')).toBe(10001);
    expect(cents('90000000000000')).toBe(9000000000000000);
    expect(cents('0')).toBe(0);
  });
  it('rechaza precisión ambigua y valores fuera de rango',()=>{
    for(const value of ['', '1.001','1.000,00','-1','Infinity','1e3','90000000000000.01'])expect(()=>cents(value)).toThrow();
  });
});
