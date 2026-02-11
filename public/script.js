const asd = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

async function f() {
    console.log(1);
    await asd(5000);
    console.log(2);
}