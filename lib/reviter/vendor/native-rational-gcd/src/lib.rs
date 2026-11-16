#![no_std]
// Binary GCD over little-endian u64 limbs in two fixed buffers. Odd-part subtraction, then the common power of two.
#[panic_handler] fn panic(_: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }
const CAP: usize = 256;
static mut A: [u64; CAP] = [0; CAP];
static mut B: [u64; CAP] = [0; CAP];
#[no_mangle] pub extern "C" fn a_ptr() -> *mut u64 { core::ptr::addr_of_mut!(A) as *mut u64 }
#[no_mangle] pub extern "C" fn b_ptr() -> *mut u64 { core::ptr::addr_of_mut!(B) as *mut u64 }
#[no_mangle] pub extern "C" fn cap() -> u32 { CAP as u32 }
#[inline] fn trim(x: &[u64], mut n: usize) -> usize { while n > 0 && x[n - 1] == 0 { n -= 1 } n }
#[inline] fn tz(x: &[u64], _n: usize) -> u32 { let mut i = 0; while x[i] == 0 { i += 1 } i as u32 * 64 + x[i].trailing_zeros() }
fn shr(x: &mut [u64], n: usize, s: u32) -> usize { let (w, b) = ((s / 64) as usize, s % 64); let m = n - w;
  if b == 0 { for i in 0..m { x[i] = x[i + w] } } else { for i in 0..m { let hi = if i + w + 1 < n { x[i + w + 1] } else { 0 }; x[i] = (x[i + w] >> b) | (hi << (64 - b)) } }
  for i in m..n { x[i] = 0 } trim(x, m) }
fn shl(x: &mut [u64], n: usize, s: u32) -> usize { if s == 0 { return n } let (w, b) = ((s / 64) as usize, s % 64); let m = n + w + 1;
  let mut i = m; while i > 0 { i -= 1; let lo = if i >= w && i - w < n { x[i - w] } else { 0 }; let lo2 = if i >= w + 1 && i - w - 1 < n { x[i - w - 1] } else { 0 }; x[i] = if b == 0 { lo } else { (lo << b) | (lo2 >> (64 - b)) } } trim(x, m) }
fn cmp(a: &[u64], an: usize, b: &[u64], bn: usize) -> i32 { if an != bn { return if an > bn { 1 } else { -1 } } let mut i = an; while i > 0 { i -= 1; if a[i] != b[i] { return if a[i] > b[i] { 1 } else { -1 } } } 0 }
fn sub(a: &mut [u64], an: usize, b: &[u64], bn: usize) -> usize { let mut c = 0u64; for i in 0..an { let y = if i < bn { b[i] } else { 0 }; let (d, b1) = a[i].overflowing_sub(y); let (d2, b2) = d.overflowing_sub(c); a[i] = d2; c = (b1 | b2) as u64 } trim(a, an) }
fn g64(mut a: u64, mut b: u64) -> u64 { if a == 0 { return b } if b == 0 { return a } b >>= b.trailing_zeros(); loop { a >>= a.trailing_zeros(); if a < b { core::mem::swap(&mut a, &mut b) } a -= b; if a == 0 { return b } } }
/// Inputs are non-zero magnitudes of an and bn limbs. Result is left in A; returns its limb count.
#[no_mangle] pub unsafe extern "C" fn gcd(an: u32, bn: u32) -> u32 {
  let a = &mut *core::ptr::addr_of_mut!(A); let b = &mut *core::ptr::addr_of_mut!(B);
  let (mut an, mut bn) = (an as usize, bn as usize); let (za, zb) = (tz(a, an), tz(b, bn)); let common = za.min(zb);
  an = shr(a, an, za); bn = shr(b, bn, zb);
  let (mut x, mut y) = (a, b);
  loop {
    if an == 1 && bn == 1 { x[0] = g64(x[0], y[0]); an = 1; break }
    match cmp(&x[..], an, &y[..], bn) { 0 => break, -1 => { core::mem::swap(&mut x, &mut y); core::mem::swap(&mut an, &mut bn) } _ => {} }
    an = sub(&mut x[..], an, &y[..], bn); let s = tz(&x[..], an); an = shr(&mut x[..], an, s);
  }
  if !core::ptr::eq(x as *const _, core::ptr::addr_of!(A) as *const _) { let n = an; for i in 0..n { let v = x[i]; (*core::ptr::addr_of_mut!(A))[i] = v } }
  let aa = &mut *core::ptr::addr_of_mut!(A); shl(aa, an, common) as u32
}
