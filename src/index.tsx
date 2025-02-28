import React from 'react';
import satori, { init } from 'satori/wasm';
import initYoga from 'yoga-wasm-web';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { ExportedHandler, R2Bucket } from '@cloudflare/workers-types';

// @ts-ignore
import yogaWasm from '../node_modules/yoga-wasm-web/dist/yoga.wasm';
// @ts-ignore
import resvgWasm from '../node_modules/@resvg/resvg-wasm/index_bg.wasm';

init(await initYoga(yogaWasm as WebAssembly.Module));
await initWasm(resvgWasm);

let fontArrBuf: null | ArrayBuffer = null;
let sakuraImageBase64: null | string = null;

type Handler = ExportedHandler<{
	SAKURA_OGP: R2Bucket;
}>;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

const calculateFontSize = (text: string, containerWidth: number, containerHeight: number) => {
	// 基本のフォントサイズ（コンテナの高さの1/3）
	const baseSize = Math.min(containerWidth / 8, containerHeight / 3);

	// テキストの長さに基づいて調整
	const textLength = text.length;
	let fontSize = baseSize;

	if (textLength > 10) {
		// 10文字以上の場合、文字数に応じてフォントサイズを縮小
		fontSize = baseSize * (10 / textLength);
	}

	// 最小フォントサイズを設定（コンテナ高さの1/10以下にはしない）
	const minFontSize = containerHeight / 10;
	return Math.max(fontSize, minFontSize);
};

const handler: Handler = {
	fetch: async (request, env) => {
		const url = new URL(request.url);
		const pathSegments = url.pathname.split('/').filter((segment) => segment !== '');

		// HTMLエンドポイントの場合
		if (pathSegments[0] === 'html') {
			const width = 1200; // デフォルトのOGPサイズ
			const height = 630;
			const text = pathSegments[1] || 'デフォルトテキスト';
			const user_id = pathSegments[2] || 'デフォルトユーザー';
			const tree_id = pathSegments[3] || 'デフォルトツリー';
			const imageUrl = `${url.origin}/image/${width}/${height}/${encodeURIComponent(text)}`;
			const redirectUrl = `https://dreamtree.pages.dev/trees/${user_id}/${tree_id}`;

			const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${decodeURIComponent(text)}</title>
    <meta property="og:title" content="${decodeURIComponent(text)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${url.origin}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:description" content="桜と共に描かれたテキスト画像" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@YourTwitterHandle" />
    <meta name="twitter:title" content="${decodeURIComponent(text)}" />
    <meta name="twitter:description" content="桜と共に描かれたテキスト画像" />
    <meta name="twitter:image" content="${imageUrl}" />
</head>
<body>
    <script>
    setTimeout(() => {
        window.location.href = '${redirectUrl}';
    }, 1000); // 1秒待ってからリダイレクト
    </script>
</body>
</html>`;

			return new Response(html, {
				headers: {
					'Content-Type': 'text/html;charset=UTF-8',
				},
			});
		}

		// 画像生成エンドポイントの場合
		if (pathSegments[0] === 'image') {
			// フォントファイルをまだ取得していなければ、取得してArrayBufferとして格納
			if (fontArrBuf === null || sakuraImageBase64 === null) {
				const [fontObj, sakuraObj] = await Promise.all([
					env.SAKURA_OGP.get('fonts/NotoSansJP-Regular.otf'),
					env.SAKURA_OGP.get('images/sakura.png'),
				]);

				if (!fontObj || !sakuraObj) {
					return new Response('Required assets not found', {
						status: 500,
						headers: { 'Content-Type': 'text/plain' },
					});
				}

				fontArrBuf = await fontObj.arrayBuffer();
				const sakuraBuffer = await sakuraObj.arrayBuffer();
				sakuraImageBase64 = `data:image/png;base64,${arrayBufferToBase64(sakuraBuffer)}`;
			}

			const width = parseInt(pathSegments[1], 10);
			const height = parseInt(pathSegments[2], 10);
			const text = decodeURIComponent(pathSegments[3]);

			const ZeroMarginParagraph = ({ children }: { children: React.ReactNode }) => <p style={{ margin: 0, padding: 0 }}>{children}</p>;

			const ogpNode = (
				<div
					style={{
						width: `${width}px`,
						height: `${height}px`,
						display: 'flex',
						justifyContent: 'center',
						alignItems: 'center',
						position: 'relative',
						background: '#fff',
					}}
				>
					<img
						src={sakuraImageBase64}
						style={{
							position: 'absolute',
							width: '100%',
							height: '100%',
							objectFit: 'cover',
						}}
					/>
					<div
						style={{
							position: 'absolute',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: '100%',
							height: '100%',
							zIndex: 1,
						}}
					>
						<div
							style={{
								fontSize: `${calculateFontSize(text, width, height)}px`,
								color: '#fff',
								textShadow: '4px 4px 8px rgba(0, 0, 0, 0.7)',
								textAlign: 'center',
								maxWidth: '90%', // 幅を90%に増やして余裕を持たせる
								fontWeight: 'bold',
								lineHeight: '1.2',
								wordBreak: 'keep-all', // 単語の途中での改行を防ぐ
								overflowWrap: 'break-word', // 長い単語は必要に応じて改行
							}}
						>
							{decodeURIComponent(text)}
						</div>
					</div>
				</div>
			);

			// Satoriを使ってsvgを生成する
			const svg = await satori(ogpNode, {
				width: width,
				height: height,
				fonts: [
					{
						name: 'NotoSansJP',
						data: fontArrBuf,
						weight: 100,
						style: 'normal',
					},
				],
			});

			const png = new Resvg(svg).render().asPng();

			return new (Response as any)(png, {
				headers: {
					'Content-Type': 'image/png',
					'Cache-Control': 'max-age=604800',
				},
			});
		}

		return new Response('Invalid endpoint', {
			status: 400,
			headers: { 'Content-Type': 'text/plain' },
		});
	},
};

export default handler;
