#include <iostream>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <thread>
#include "portaudio.h"
#include "opus.h"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "portaudio_x64.lib")

#define SERVER_IP "172.25.144.42"
#define SERVER_PORT 50005
#define SAMPLE_RATE 48000
#define FRAME_SIZE 960
#define BUFFER_SIZE 4096

struct AudioData {
    PaStream* inputStream;   // 输入流（录音）
    PaStream* outputStream;  // 输出流（播放）
    OpusEncoder* encoder;
    OpusDecoder* decoder;
    SOCKET sock;
    sockaddr_in serverAddr;
};

// 录音回调
static int recordCallback(const void* input, void* output, unsigned long frameCount,
    const PaStreamCallbackTimeInfo* timeInfo, PaStreamCallbackFlags statusFlags, void* userData) {
    AudioData* data = (AudioData*)userData;
    if (!data || !data->encoder) {
        std::cerr << "recordCallback: data 或 encoder 为空，跳过处理\n";
        return paContinue;
    }
    unsigned char encodedData[BUFFER_SIZE];
    int encodedBytes = opus_encode(data->encoder, (const opus_int16*)input, FRAME_SIZE, encodedData, BUFFER_SIZE);
    if (encodedBytes > 0) {
        sendto(data->sock, (char*)encodedData, encodedBytes, 0, (sockaddr*)&data->serverAddr, sizeof(data->serverAddr));
    }
    return paContinue;
}

// 监听服务器数据
void receiveThread(AudioData* data) {
    char recvBuffer[BUFFER_SIZE];
    opus_int16 decodedBuffer[FRAME_SIZE];
    sockaddr_in senderAddr;
    int senderLen = sizeof(senderAddr);
    while (true) {
        int received = recvfrom(data->sock, recvBuffer, BUFFER_SIZE, 0, (sockaddr*)&senderAddr, &senderLen);
        if (received > 0) {
            int decodedSamples = opus_decode(data->decoder, (unsigned char*)recvBuffer, received, decodedBuffer, FRAME_SIZE, 0);
            if (decodedSamples > 0) {
                PaError err = Pa_WriteStream(data->outputStream, decodedBuffer, decodedSamples);
                if (err != paNoError) {
                    std::cerr << "Pa_WriteStream 错误: " << Pa_GetErrorText(err) << std::endl;
                }
            }
        }
    }
}

int main() {
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);

    SOCKET sock = socket(AF_INET, SOCK_DGRAM, 0);
    sockaddr_in serverAddr = {};
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_port = htons(SERVER_PORT);
    inet_pton(AF_INET, SERVER_IP, &serverAddr.sin_addr);

    AudioData* data = new AudioData();

    // 初始化 PortAudio
    PaError portAudioErr = Pa_Initialize();
    if (portAudioErr != paNoError) {
        std::cerr << "PortAudio 初始化失败: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    // 设置输入参数（录音）
    PaStreamParameters inputParams;
    inputParams.device = Pa_GetDefaultInputDevice();
    if (inputParams.device == paNoDevice) {
        std::cerr << "没有可用的输入设备" << std::endl;
        return -1;
    }
    inputParams.channelCount = 1;
    inputParams.sampleFormat = paInt16;
    inputParams.suggestedLatency = Pa_GetDeviceInfo(inputParams.device)->defaultLowInputLatency;
    inputParams.hostApiSpecificStreamInfo = nullptr;

    // 设置输出参数（播放）
    PaStreamParameters outputParams;
    outputParams.device = Pa_GetDefaultOutputDevice();
    if (outputParams.device == paNoDevice) {
        std::cerr << "没有可用的输出设备" << std::endl;
        return -1;
    }
    outputParams.channelCount = 1;
    outputParams.sampleFormat = paInt16;
    outputParams.suggestedLatency = Pa_GetDeviceInfo(outputParams.device)->defaultLowOutputLatency;
    outputParams.hostApiSpecificStreamInfo = nullptr;

    // 打开输入流（录音）
    portAudioErr = Pa_OpenStream(&data->inputStream, &inputParams, nullptr, SAMPLE_RATE, FRAME_SIZE, paClipOff, recordCallback, data);
    if (portAudioErr != paNoError) {
        std::cerr << "输入流打开失败: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    // 打开输出流（播放）
    portAudioErr = Pa_OpenStream(&data->outputStream, nullptr, &outputParams, SAMPLE_RATE, FRAME_SIZE, paClipOff, nullptr, nullptr);
    if (portAudioErr != paNoError) {
        std::cerr << "输出流打开失败: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    // 启动音频流
    portAudioErr = Pa_StartStream(data->inputStream);
    if (portAudioErr != paNoError) {
        std::cerr << "输入流启动失败: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    portAudioErr = Pa_StartStream(data->outputStream);
    if (portAudioErr != paNoError) {
        std::cerr << "输出流启动失败: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    // 初始化 Opus
    int opusErr;
    data->encoder = opus_encoder_create(SAMPLE_RATE, 1, OPUS_APPLICATION_VOIP, &opusErr);
    if (opusErr != OPUS_OK) {
        std::cerr << "Opus 编码器初始化失败: " << opus_strerror(opusErr) << std::endl;
        return -1;
    }

    data->decoder = opus_decoder_create(SAMPLE_RATE, 1, &opusErr);
    if (opusErr != OPUS_OK) {
        std::cerr << "Opus 解码器初始化失败: " << opus_strerror(opusErr) << std::endl;
        return -1;
    }

    // 设置网络参数
    data->sock = sock;
    data->serverAddr = serverAddr;

    // 启动接收线程
    std::thread recvThread(receiveThread, data);
    recvThread.detach();

    std::cout << "加入语音聊天室，按 Enter 退出...\n";
    std::cin.get();

    // 清理资源
    Pa_StopStream(data->inputStream);
    Pa_StopStream(data->outputStream);
    Pa_CloseStream(data->inputStream);
    Pa_CloseStream(data->outputStream);
    Pa_Terminate();
    closesocket(sock);
    WSACleanup();
    opus_encoder_destroy(data->encoder);
    opus_decoder_destroy(data->decoder);
    delete data;
    return 0;
}