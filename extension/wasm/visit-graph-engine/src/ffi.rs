use std::cell::Cell;
use std::mem;

thread_local! {
    static LAST_RESULT_LEN: Cell<usize> = const { Cell::new(0) };
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::null_mut();
    }

    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    mem::forget(buffer);
    ptr
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }

    unsafe {
        drop(Vec::from_raw_parts(ptr, len, len));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn last_result_len() -> usize {
    LAST_RESULT_LEN.with(Cell::get)
}

#[unsafe(no_mangle)]
pub extern "C" fn free_result(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }

    unsafe {
        let slice_ptr = std::ptr::slice_from_raw_parts_mut(ptr, len);
        drop(Box::from_raw(slice_ptr));
    }
}

pub(crate) fn read_input<'a>(ptr: *const u8, len: usize) -> Result<&'a [u8], String> {
    if len == 0 {
        return Ok(&[]);
    }

    if ptr.is_null() {
        return Err("received null pointer for non-empty input".to_owned());
    }

    unsafe { Ok(std::slice::from_raw_parts(ptr, len)) }
}

pub(crate) fn store_result(bytes: Vec<u8>) -> *mut u8 {
    let len = bytes.len();
    LAST_RESULT_LEN.with(|cell| cell.set(len));

    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    mem::forget(boxed);
    ptr
}
